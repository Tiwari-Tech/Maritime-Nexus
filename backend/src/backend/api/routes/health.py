from fastapi import APIRouter, Response, status

from backend.core.config import settings
from backend.db.session import check_db_connection

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Liveness Health Check")
def health_check() -> dict[str, str]:
    """Basic liveness check returning API operational status."""
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
    }


@router.get("/readiness", summary="Readiness Health Check")
def readiness_check(response: Response) -> dict[str, str]:
    """Readiness probe verifying that backend dependencies (database) are reachable.

    Returns HTTP 200 if healthy, or HTTP 503 if the database is unreachable.
    Never exposes credentials or internal connection strings.
    """
    try:
        db_connected = check_db_connection()
    except Exception:
        db_connected = False

    if not db_connected:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "unhealthy",
            "database": "disconnected",
        }

    return {
        "status": "ready",
        "database": "connected",
    }
