"""RAG semantic vector search API routes for Maritime Nexus."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.api.dependencies import get_current_org, get_current_user
from backend.db.session import get_db
from backend.models.organization import Organization, User
from backend.schemas.rag import (
    RAGSearchRequest,
    RAGSearchResponse,
    RAGSearchResultItem,
)
from backend.services.retrieval import search_document_chunks

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rag", tags=["RAG"])


@router.post(
    "/search",
    response_model=RAGSearchResponse,
    summary="Semantic vector search across organization documents",
)
def semantic_search(
    payload: RAGSearchRequest,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> RAGSearchResponse:
    """Execute semantic vector similarity search against indexed document chunks.

    Strict multi-tenant security:
    - Queries are embedded using BGE-M3 in Ollama.
    - Matches are filtered strictly to documents belonging to the authenticated organization.
    - Chunks are ranked by cosine similarity descending.
    """
    try:
        raw_results = search_document_chunks(
            query=payload.query,
            organization_id=current_org.id,
            db=db,
            document_id=payload.document_id,
            top_k=payload.top_k,
        )
    except RuntimeError as exc:
        logger.error("RAG search failed due to embedding service error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    results = [
        RAGSearchResultItem(
            chunk_id=item.chunk_id,
            document_id=item.document_id,
            document_title=item.document_title,
            chunk_index=item.chunk_index,
            page_number=item.page_number,
            content=item.content,
            similarity_score=item.similarity_score,
            metadata=item.metadata,
        )
        for item in raw_results
    ]

    return RAGSearchResponse(
        query=payload.query,
        total_results=len(results),
        results=results,
    )
