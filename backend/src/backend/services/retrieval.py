"""Semantic vector retrieval service for Maritime Nexus RAG pipeline.

Executes pgvector cosine similarity searches strictly scoped to the authenticated
user's organization.
"""

import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.models.document import Document
from backend.models.document_chunk import DocumentChunk
from backend.services.embedding import get_query_embedding

logger = logging.getLogger(__name__)


@dataclass
class SearchResultItem:
    """Individual retrieved document chunk with similarity metadata."""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    chunk_index: int
    page_number: int | None
    content: str
    similarity_score: float
    metadata: dict[str, Any]


def search_document_chunks(
    query: str,
    organization_id: uuid.UUID,
    db: Session,
    document_id: uuid.UUID | None = None,
    top_k: int | None = None,
    timings: dict[str, float] | None = None,
) -> list[SearchResultItem]:
    """Retrieve the most semantically relevant document chunks using pgvector.

    Strict multi-tenant security: Chunks are joined against the documents table
    and filtered by Document.organization_id.

    Args:
        query: User search query string.
        organization_id: Authenticated user's organization ID.
        db: Active SQLAlchemy session.
        document_id: Optional filter to restrict search to a specific document.
        top_k: Number of results to return (capped by RAG_MAX_TOP_K).
        timings: Optional dictionary to record fine-grained diagnostic timings.

    Returns:
        List of SearchResultItem ordered by semantic similarity descending.
    """
    clean_query = query.strip()
    if not clean_query:
        if timings is not None:
            timings["embedding"] = 0.0
            timings["retrieval"] = 0.0
        return []

    # Enforce bounds on top_k
    k = top_k or settings.RAG_DEFAULT_TOP_K
    k = max(1, min(k, settings.RAG_MAX_TOP_K))

    # 1. Generate query embedding via BGE-M3
    t_embed_start = time.perf_counter()
    query_vector = get_query_embedding(clean_query)
    t_embed_end = time.perf_counter()
    if timings is not None:
        timings["embedding"] = t_embed_end - t_embed_start

    # 2. Build pgvector query with organization scoping
    t_retrieval_start = time.perf_counter()
    distance_col = DocumentChunk.embedding.cosine_distance(query_vector).label("distance")

    stmt = (
        db.query(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.chunk_index,
            DocumentChunk.page_number,
            DocumentChunk.content,
            DocumentChunk.extra_metadata,
            Document.title.label("document_title"),
            distance_col,
        )
        .join(Document, Document.id == DocumentChunk.document_id)
        .filter(
            Document.organization_id == organization_id,
            DocumentChunk.embedding.isnot(None),
        )
    )

    if document_id:
        stmt = stmt.filter(DocumentChunk.document_id == document_id)

    # Order by cosine distance ascending (closest match first)
    rows = stmt.order_by(distance_col).limit(k).all()
    t_retrieval_end = time.perf_counter()
    if timings is not None:
        timings["retrieval"] = t_retrieval_end - t_retrieval_start

    results: list[SearchResultItem] = []
    for chunk_id, doc_id, chunk_index, page_number, content, extra_metadata, doc_title, distance in rows:
        # Cosine distance ranges from 0 (identical) to 2 (opposite); cosine similarity = 1 - distance
        dist_float = float(distance) if distance is not None else 1.0
        similarity = round(max(0.0, 1.0 - dist_float), 4)

        results.append(
            SearchResultItem(
                chunk_id=chunk_id,
                document_id=doc_id,
                document_title=doc_title,
                chunk_index=chunk_index,
                page_number=page_number,
                content=content,
                similarity_score=similarity,
                metadata=extra_metadata or {},
            )
        )

    logger.info(
        "Semantic search for '%s' returned %d chunks (org: %s, top_k: %d)",
        clean_query[:50],
        len(results),
        organization_id,
        k,
    )
    return results
