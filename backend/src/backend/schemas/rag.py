"""Pydantic schemas for Maritime Nexus RAG ingestion, semantic retrieval, and Q&A."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class IngestionResponse(BaseModel):
    """Response returned upon successful document ingestion into pgvector."""

    document_id: uuid.UUID
    status: str
    chunk_count: int


class RAGSearchRequest(BaseModel):
    """Request payload for semantic vector search."""

    query: str = Field(..., min_length=1, max_length=2000, description="Natural language query string")
    top_k: int = Field(5, ge=1, le=20, description="Number of top chunks to return")
    document_id: uuid.UUID | None = Field(None, description="Optional document filter")

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Query string cannot be empty or whitespace only")
        return clean


class RAGSearchResultItem(BaseModel):
    """An individual retrieved document chunk with semantic similarity score."""

    model_config = ConfigDict(from_attributes=True)

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    chunk_index: int
    page_number: int | None = None
    content: str
    similarity_score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class RAGSearchResponse(BaseModel):
    """Collection of retrieved chunks for a semantic search query."""

    query: str
    total_results: int
    results: list[RAGSearchResultItem]


class RAGAskRequest(BaseModel):
    """Request payload for RAG question answering."""

    query: str = Field(..., min_length=1, max_length=2000, description="Question to answer using organization documents")
    top_k: int | None = Field(None, ge=1, le=20, description="Optional number of top context chunks to retrieve")
    document_id: uuid.UUID | None = Field(None, description="Optional document filter")

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Query string cannot be empty or whitespace only")
        return clean


class RAGSourceReference(BaseModel):
    """Source chunk reference used in RAG answer generation."""

    model_config = ConfigDict(from_attributes=True)

    document_id: uuid.UUID
    chunk_id: uuid.UUID
    document_title: str
    page_number: int | None = None
    score: float


class RAGAskResponse(BaseModel):
    """Response schema for RAG question answering."""

    answer: str
    sources: list[RAGSourceReference]
