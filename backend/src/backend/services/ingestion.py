"""Document ingestion service for Maritime Nexus RAG pipeline.

Coordinates the full ingestion flow:
1. Verify organization ownership and PDF format.
2. Download file from private GCS bucket.
3. Extract page-aware text via PyMuPDF.
4. Chunk text deterministically.
5. Generate dense BGE-M3 embeddings via Ollama.
6. Persist DocumentChunk records in PostgreSQL/pgvector.
7. Update Document status to 'ready' (or 'failed' on error).
"""

import logging
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.models.document import Document
from backend.models.document_chunk import DocumentChunk
from backend.services.chunking import chunk_extracted_pages
from backend.services.embedding import get_batch_embeddings
from backend.services.extraction import extract_text_from_pdf_bytes
from backend.services.storage import download_document_bytes, parse_blob_name_from_uri

logger = logging.getLogger(__name__)


@dataclass
class IngestionResult:
    """Result summary of a document ingestion run."""

    document_id: uuid.UUID
    status: str
    chunk_count: int


def ingest_document(
    document_id: uuid.UUID,
    organization_id: uuid.UUID,
    db: Session,
) -> IngestionResult:
    """Ingest a document into the RAG pipeline with vector embeddings.

    Args:
        document_id: Primary key of the Document.
        organization_id: Authenticated user's organization ID.
        db: Active SQLAlchemy session.

    Returns:
        IngestionResult with processing status and chunk count.

    Raises:
        HTTPException 404: If document does not exist or does not belong to organization.
        HTTPException 400: If document is not a PDF or has no extractable text.
        HTTPException 502/503: If GCS or Ollama fails.
    """
    # 1. Verify document exists and belongs to current organization
    doc = (
        db.query(Document)
        .filter(
            Document.id == document_id,
            Document.organization_id == organization_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or inaccessible",
        )

    if doc.file_type.lower() != "pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported document file type '{doc.file_type}'. Only PDF is supported for RAG ingestion.",
        )

    if not doc.gcs_uri:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document has no storage reference",
        )

    # 2. Mark document as 'processing'
    doc.status = "processing"
    doc.error_message = None
    db.commit()

    blob_name = parse_blob_name_from_uri(doc.gcs_uri)

    try:
        # 3. Download bytes from private GCS
        try:
            pdf_bytes = download_document_bytes(blob_name)
        except FileNotFoundError as exc:
            logger.error("Document blob %s not found in GCS: %s", blob_name, exc)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document file not found in cloud storage",
            ) from exc
        except Exception as exc:
            logger.error("Failed downloading document from GCS: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to retrieve document from cloud storage",
            ) from exc

        # 4. Extract page-aware text
        try:
            pages = extract_text_from_pdf_bytes(pdf_bytes)
        except ValueError as exc:
            logger.warning("PDF extraction failed for doc %s: %s", document_id, exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        # 5. Chunk text
        chunks_data = chunk_extracted_pages(pages)
        if not chunks_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No usable chunks generated from document text",
            )

        # 6. Generate embeddings via BGE-M3 in Ollama
        chunk_texts = [c.content for c in chunks_data]
        try:
            embeddings = get_batch_embeddings(chunk_texts)
        except RuntimeError as exc:
            logger.error("Ollama embedding failed for doc %s: %s", document_id, exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc

        # 7. Reprocessing safety: delete existing chunks for this document
        db.query(DocumentChunk).filter(DocumentChunk.document_id == doc.id).delete()

        # 8. Create DocumentChunk records
        chunk_records: list[DocumentChunk] = []
        for chunk_item, emb in zip(chunks_data, embeddings, strict=True):
            chunk_records.append(
                DocumentChunk(
                    id=uuid.uuid4(),
                    document_id=doc.id,
                    chunk_index=chunk_item.chunk_index,
                    page_number=chunk_item.page_number,
                    content=chunk_item.content,
                    token_count=chunk_item.token_count,
                    embedding=emb,
                    extra_metadata=chunk_item.metadata,
                )
            )

        db.add_all(chunk_records)

        # 9. Update document status to ready
        doc.status = "ready"
        doc.error_message = None
        db.commit()

        logger.info(
            "Successfully ingested document %s (%d chunks created)",
            document_id,
            len(chunk_records),
        )

        return IngestionResult(
            document_id=doc.id,
            status="ready",
            chunk_count=len(chunk_records),
        )

    except HTTPException as exc:
        db.rollback()
        # Record failure status on document
        doc.status = "failed"
        doc.error_message = exc.detail
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise

    except Exception as exc:
        db.rollback()
        logger.exception("Unexpected error during document ingestion: %s", exc)
        doc.status = "failed"
        doc.error_message = "Unexpected ingestion failure"
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Document ingestion encountered an unexpected internal error",
        ) from exc
