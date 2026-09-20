"""Database verification and inspection utilities.

Schema creation and migrations are managed exclusively via Alembic.
This module provides connection and schema verification helpers without modifying the database.
"""

import logging
from sqlalchemy import inspect, text

from backend.db.session import engine

logger = logging.getLogger(__name__)


def check_db_connectivity() -> bool:
    """Verify that the PostgreSQL database is reachable with a lightweight query."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            return result.scalar() == 1
    except Exception as exc:
        logger.error("Database connectivity check failed: %s", type(exc).__name__)
        return False


def check_pgvector_installed() -> bool:
    """Verify that the pgvector extension is active in the database."""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
            )
            return result.scalar() == "vector"
    except Exception as exc:
        logger.error("pgvector extension check failed: %s", type(exc).__name__)
        return False


def get_existing_table_names() -> list[str]:
    """Retrieve the list of tables currently existing in the database."""
    try:
        inspector = inspect(engine)
        return sorted(inspector.get_table_names())
    except Exception as exc:
        logger.error("Failed to inspect database tables: %s", type(exc).__name__)
        return []
