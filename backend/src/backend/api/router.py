from fastapi import APIRouter
from backend.api.routes import (
    auth,
    contracts,
    documents,
    health,
    organizations,
    ports,
    rag,
    vessels,
    voyages,
)

api_router = APIRouter()

# Liveness + readiness
api_router.include_router(health.router)

# Authentication — mounted under /api/v1/auth
api_router.include_router(auth.router, prefix="/api/v1")

# Organizations — mounted under /api/v1/organizations
api_router.include_router(organizations.router, prefix="/api/v1")

# Document Management — mounted under /api/v1/documents
api_router.include_router(documents.router, prefix="/api/v1")

# Semantic Vector Search / RAG — mounted under /api/v1/rag
api_router.include_router(rag.router, prefix="/api/v1")

# Voyage Management — mounted under /api/v1/voyages
api_router.include_router(voyages.router, prefix="/api/v1")

# Vessel Management — mounted under /api/v1/vessels
api_router.include_router(vessels.router, prefix="/api/v1")

# Port Management — mounted under /api/v1/ports
api_router.include_router(ports.router, prefix="/api/v1")

# Contract Management — mounted under /api/v1/contracts
api_router.include_router(contracts.router, prefix="/api/v1")




