from fastapi import APIRouter

from backend.api.routes import auth, documents, health, rag

api_router = APIRouter()

# Liveness + readiness
api_router.include_router(health.router)

# Authentication — mounted under /api/v1/auth
api_router.include_router(auth.router, prefix="/api/v1")

# Document Management — mounted under /api/v1/documents
api_router.include_router(documents.router, prefix="/api/v1")

# Semantic Vector Search / RAG — mounted under /api/v1/rag
api_router.include_router(rag.router, prefix="/api/v1")
