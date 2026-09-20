import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from backend.api.router import api_router
from backend.core.config import settings
from backend.core.firebase import get_firebase_app

logger = logging.getLogger(__name__)


def create_application() -> FastAPI:
    """Initialize and configure the FastAPI application."""
    application = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description=settings.DESCRIPTION,
    )

    @application.on_event("startup")
    def _startup() -> None:
        """Initialize Firebase Admin SDK at startup — never at import time."""
        get_firebase_app()
        logger.info("Firebase Admin SDK initialized")

    # Register API routes
    application.include_router(api_router)

    return application


app = create_application()
