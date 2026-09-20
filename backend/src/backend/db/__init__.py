"""Database module containing session, engine, base, and pgvector configuration."""

from backend.db.base import Base
from backend.db.init_db import (
    check_db_connectivity,
    check_pgvector_installed,
    get_existing_table_names,
)
from backend.db.session import SessionLocal, check_db_connection, engine, get_db
from backend.db.vector import Vector, get_vector_type

__all__ = [
    "Base",
    "engine",
    "SessionLocal",
    "get_db",
    "check_db_connection",
    "check_db_connectivity",
    "check_pgvector_installed",
    "get_existing_table_names",
    "Vector",
    "get_vector_type",
]
