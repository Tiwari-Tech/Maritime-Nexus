"""Port Management API routes for Maritime Nexus.

Endpoints for authenticated port directory creation, listing, retrieval,
partial update, and safe deletion.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.api.dependencies import (
    get_current_org,
    get_current_user,
    require_manager_or_above,
    require_operator_or_above,
)
from backend.db.session import get_db
from backend.models.organization import Organization, User
from backend.models.port import Port
from backend.models.voyage import Voyage
from backend.models.voyage_event import VoyageEvent
from backend.schemas.port import (
    PortCreate,
    PortDeleteResponse,
    PortListResponse,
    PortRead,
    PortUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ports", tags=["Ports"])


# ─── Port CRUD Endpoints ─────────────────────────────────────────────────────


@router.post(
    "",
    response_model=PortRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new port in the directory",
)
def create_port(
    payload: PortCreate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Port:
    """Register a new maritime port or terminal facility in the global directory.

    - Authenticated user with an active organization required.
    - Validates global uniqueness of UN/LOCODE (409 Conflict if duplicate).
    - Requires Operator role or above.
    """
    clean_unlocode = payload.unlocode.strip().upper()
    clean_name = payload.name.strip()
    clean_country = payload.country.strip()
    clean_country_code = payload.country_code.strip().upper() if payload.country_code else None
    clean_timezone = payload.timezone.strip() if payload.timezone else None

    # 1. Enforce global uniqueness constraint on UN/LOCODE
    existing = db.query(Port).filter(Port.unlocode == clean_unlocode).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Port with UN/LOCODE '{clean_unlocode}' already exists",
        )

    # 2. Instantiate and persist port
    port = Port(
        unlocode=clean_unlocode,
        name=clean_name,
        country=clean_country,
        country_code=clean_country_code,
        latitude=payload.latitude,
        longitude=payload.longitude,
        timezone=clean_timezone,
    )
    db.add(port)
    try:
        db.commit()
        db.refresh(port)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to commit port: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist port record",
        ) from exc

    logger.info("Created port %s (%s - %s) by user %s", port.id, clean_unlocode, clean_name, current_user.id)
    return port


@router.get(
    "",
    response_model=PortListResponse,
    summary="List ports with filtering, text search, and pagination",
)
def list_ports(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    country: str | None = Query(None, description="Filter by country name"),
    country_code: str | None = Query(None, description="Filter by ISO 2-letter country code"),
    unlocode: str | None = Query(None, description="Filter by exact UN/LOCODE"),
    search: str | None = Query(None, description="Search across port name, UN/LOCODE, or country"),
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> PortListResponse:
    """Retrieve ports directory with model-backed query filtering and pagination."""
    query = db.query(Port)

    if country:
        query = query.filter(Port.country.ilike(f"%{country.strip()}%"))
    if country_code:
        query = query.filter(Port.country_code == country_code.strip().upper())
    if unlocode:
        query = query.filter(Port.unlocode == unlocode.strip().upper())
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Port.name.ilike(term),
                Port.unlocode.ilike(term),
                Port.country.ilike(term),
            )
        )

    total = query.count()
    offset = (page - 1) * page_size
    items = (
        query.order_by(Port.created_at.desc(), Port.id.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return PortListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{port_id}",
    response_model=PortRead,
    summary="Get port details by ID",
)
def get_port(
    port_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Port:
    """Retrieve full details of a single port entity."""
    port = db.query(Port).filter(Port.id == port_id).first()
    if not port:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Port not found",
        )
    return port


@router.patch(
    "/{port_id}",
    response_model=PortRead,
    summary="Update port details (partial update)",
)
def update_port(
    port_id: uuid.UUID,
    payload: PortUpdate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Port:
    """Update fields on an existing port entity with uniqueness validation."""
    port = db.query(Port).filter(Port.id == port_id).first()
    if not port:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Port not found",
        )

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return port

    # 1. Enforce unique UN/LOCODE constraint if updated
    if "unlocode" in updates and updates["unlocode"] is not None:
        clean_unlocode = updates["unlocode"].strip().upper()
        if clean_unlocode != port.unlocode:
            existing = (
                db.query(Port)
                .filter(
                    Port.unlocode == clean_unlocode,
                    Port.id != port.id,
                )
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Port with UN/LOCODE '{clean_unlocode}' already exists",
                )
        updates["unlocode"] = clean_unlocode

    # 2. Apply updates
    for field, value in updates.items():
        if field in ("name", "country") and value is not None:
            setattr(port, field, value.strip())
        elif field == "country_code" and value is not None:
            setattr(port, field, value.strip().upper())
        elif field == "timezone" and value is not None:
            setattr(port, field, value.strip())
        else:
            setattr(port, field, value)

    try:
        db.commit()
        db.refresh(port)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to update port %s: %s", port_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update port record",
        ) from exc

    logger.info("Updated port %s (%s)", port.id, port.unlocode)
    return port


@router.delete(
    "/{port_id}",
    response_model=PortDeleteResponse,
    summary="Delete a port (Admin and Manager only)",
)
def delete_port(
    port_id: uuid.UUID,
    current_user: User = Depends(require_manager_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> PortDeleteResponse:
    """Delete a port record. Restricted to Admin and Manager roles.

    Operational safeguard: If existing voyages or voyage events reference this port,
    deletion is rejected with 409 Conflict to protect operational and timeline history.
    """
    port = db.query(Port).filter(Port.id == port_id).first()
    if not port:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Port not found",
        )

    # 1. Operational history protection: check referencing voyages
    voyage_ref = (
        db.query(Voyage)
        .filter(
            or_(
                Voyage.origin_port_id == port_id,
                Voyage.destination_port_id == port_id,
            )
        )
        .first()
    )
    if voyage_ref:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete port referenced by existing voyages. Operational history must be preserved.",
        )

    # 2. Operational history protection: check referencing voyage events
    event_ref = db.query(VoyageEvent).filter(VoyageEvent.port_id == port_id).first()
    if event_ref:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete port referenced by existing voyage events. Operational history must be preserved.",
        )

    db.delete(port)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete port %s: %s", port_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete port record",
        ) from exc

    logger.info("Deleted port %s by user %s", port_id, current_user.id)
    return PortDeleteResponse(
        message="Port deleted successfully",
        port_id=port_id,
    )
