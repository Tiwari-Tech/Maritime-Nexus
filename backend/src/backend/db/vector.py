"""pgvector integration module for SQLAlchemy models."""

from pgvector.sqlalchemy import Vector

from backend.core.config import settings


def get_vector_type(dim: int | None = None) -> Vector:
    """Return a pgvector Vector column type configured with the specified or default embedding dimension.

    Args:
        dim: Vector dimension. If None, defaults to settings.EMBEDDING_DIMENSION (1024 for BGE-M3).

    Returns:
        Vector: Configured pgvector SQLAlchemy Vector type.
    """
    dimension = dim if dim is not None else settings.EMBEDDING_DIMENSION
    return Vector(dimension)


__all__ = [
    "Vector",
    "get_vector_type",
]
