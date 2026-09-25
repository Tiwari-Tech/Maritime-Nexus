"""RAG semantic vector search and question answering API routes for Maritime Nexus."""

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.api.dependencies import get_current_org, get_current_user
from backend.db.session import get_db
from backend.models.organization import Organization, User
from backend.schemas.rag import (
    RAGAskRequest,
    RAGAskResponse,
    RAGSearchRequest,
    RAGSearchResponse,
    RAGSearchResultItem,
    RAGSourceReference,
)
from backend.services.llm import generate_grounded_answer
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


@router.post(
    "/ask",
    response_model=RAGAskResponse,
    summary="Grounded question answering over organization documents",
)
def rag_question_answering(
    payload: RAGAskRequest,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> RAGAskResponse:
    """Answer a user question using strictly grounded context from organization documents.

    Flow:
    1. Semantically retrieve relevant chunks for the question within the user's organization.
    2. If no relevant chunks exist, return clear message without invoking LLM.
    3. Construct grounded prompt with retrieved chunks and send to configured LLM via Ollama.
    4. Return generated answer alongside verifiable source references.
    """
    t_endpoint_start = time.perf_counter()
    retrieval_timings: dict[str, float] = {}

    # 1. Retrieve organization-scoped relevant chunks
    try:
        raw_results = search_document_chunks(
            query=payload.query,
            organization_id=current_org.id,
            db=db,
            document_id=payload.document_id,
            top_k=payload.top_k,
            timings=retrieval_timings,
        )
    except RuntimeError as exc:
        t_total = time.perf_counter() - t_endpoint_start
        logger.error("Retrieval failed for Q&A query after %.2fs: %s", t_total, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    t_embedding = retrieval_timings.get("embedding", 0.0)
    t_retrieval = retrieval_timings.get("retrieval", 0.0)

    # 2. If no relevant chunks found, do not invoke LLM
    if not raw_results:
        t_total = time.perf_counter() - t_endpoint_start
        logger.info("RAG retrieval: chunks=0 scores=[]")
        logger.info(
            "RAG ask timings: embedding=%.2fs retrieval=%.2fs prompt=0.00s llm=0.00s total=%.2fs",
            t_embedding,
            t_retrieval,
            t_total,
        )
        return RAGAskResponse(
            answer="No relevant information was found in the uploaded documents.",
            sources=[],
        )

    # 3. Format source references for response traceability
    scores = [round(item.similarity_score, 2) for item in raw_results]
    logger.info("RAG retrieval: chunks=%d scores=%s", len(raw_results), scores)

    sources = [
        RAGSourceReference(
            document_id=item.document_id,
            chunk_id=item.chunk_id,
            document_title=item.document_title,
            page_number=item.page_number,
            score=item.similarity_score,
        )
        for item in raw_results
    ]

    # 4. Generate grounded answer using configured LLM via Ollama
    llm_timings: dict[str, float] = {}
    try:
        answer = generate_grounded_answer(payload.query, raw_results, timings=llm_timings)
    except TimeoutError as exc:
        t_total = time.perf_counter() - t_endpoint_start
        t_prompt = llm_timings.get("prompt", 0.0)
        t_llm = llm_timings.get("llm", 0.0)
        logger.error(
            "RAG ask timings (TIMEOUT): embedding=%.2fs retrieval=%.2fs prompt=%.2fs llm=%.2fs total=%.2fs",
            t_embedding,
            t_retrieval,
            t_prompt,
            t_llm,
            t_total,
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        t_total = time.perf_counter() - t_endpoint_start
        t_prompt = llm_timings.get("prompt", 0.0)
        t_llm = llm_timings.get("llm", 0.0)
        logger.error(
            "RAG ask timings (FAILED): embedding=%.2fs retrieval=%.2fs prompt=%.2fs llm=%.2fs total=%.2fs",
            t_embedding,
            t_retrieval,
            t_prompt,
            t_llm,
            t_total,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error during LLM answer generation: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected failure during answer generation",
        ) from exc

    t_prompt = llm_timings.get("prompt", 0.0)
    t_llm = llm_timings.get("llm", 0.0)
    t_total = time.perf_counter() - t_endpoint_start

    logger.info(
        "RAG ask timings: embedding=%.2fs retrieval=%.2fs prompt=%.2fs llm=%.2fs total=%.2fs",
        t_embedding,
        t_retrieval,
        t_prompt,
        t_llm,
        t_total,
    )

    return RAGAskResponse(
        answer=answer,
        sources=sources,
    )
