"""Voyage Management API routes for Maritime Nexus.

Endpoints for authenticated voyage creation, listing, retrieval, partial update,
deletion, and operational milestone event tracking.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from backend.api.dependencies import (
    get_current_org,
    get_current_user,
    require_manager_or_above,
    require_operator_or_above,
)
from backend.db.session import get_db
from backend.models.organization import Organization, User
from backend.models.port import Port
from backend.models.vessel import Vessel
from backend.models.voyage import Voyage
from backend.models.voyage_event import VoyageEvent
from backend.schemas.voyage import (
    VoyageCreate,
    VoyageDeleteResponse,
    VoyageEventCreate,
    VoyageEventListResponse,
    VoyageEventRead,
    VoyageListResponse,
    VoyageRead,
    VoyageUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voyages", tags=["Voyages"])


# ─── Voyage CRUD Endpoints ───────────────────────────────────────────────────


@router.post(
    "",
    response_model=VoyageRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new voyage",
)
def create_voyage(
    payload: VoyageCreate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Voyage:
    """Create a new voyage associated with an organization-owned vessel.

    - Validates that the referenced vessel exists and belongs to the user's organization.
    - Validates that referenced origin and destination ports exist.
    - Enforces uniqueness of voyage_number per vessel (409 Conflict).
    """
    # 1. Validate vessel belongs to the authenticated user's organization
    vessel = (
        db.query(Vessel)
        .filter(
            Vessel.id == payload.vessel_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not vessel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vessel not found",
        )

    # 2. Validate ports if supplied
    if payload.origin_port_id:
        port = db.query(Port).filter(Port.id == payload.origin_port_id).first()
        if not port:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Origin port not found",
            )

    if payload.destination_port_id:
        port = db.query(Port).filter(Port.id == payload.destination_port_id).first()
        if not port:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Destination port not found",
            )

    # 3. Check for unique constraint collision (vessel_id, voyage_number)
    clean_voyage_number = payload.voyage_number.strip()
    existing = (
        db.query(Voyage)
        .filter(
            Voyage.vessel_id == payload.vessel_id,
            Voyage.voyage_number == clean_voyage_number,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Voyage '{clean_voyage_number}' already exists for this vessel",
        )

    # 4. Instantiate and commit voyage
    voyage = Voyage(
        vessel_id=payload.vessel_id,
        voyage_number=clean_voyage_number,
        origin_port_id=payload.origin_port_id,
        destination_port_id=payload.destination_port_id,
        departure_date=payload.departure_date,
        arrival_date=payload.arrival_date,
        status=payload.status.lower().strip(),
        cargo_type=payload.cargo_type.strip() if payload.cargo_type else None,
        cargo_quantity=payload.cargo_quantity,
        extra_metadata=payload.extra_metadata,
    )
    db.add(voyage)
    try:
        db.commit()
        db.refresh(voyage)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to commit voyage: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist voyage record",
        ) from exc

    logger.info("Created voyage %s for vessel %s (org: %s)", voyage.id, vessel.id, current_org.id)
    return voyage


@router.get(
    "",
    response_model=VoyageListResponse,
    summary="List organization voyages with pagination and filtering",
)
def list_voyages(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    status_filter: str | None = Query(None, alias="status", description="Filter by status (planned, in_transit, berthed, completed, cancelled)"),
    vessel_id: uuid.UUID | None = Query(None, description="Filter by vessel ID"),
    origin_port_id: uuid.UUID | None = Query(None, description="Filter by origin port ID"),
    destination_port_id: uuid.UUID | None = Query(None, description="Filter by destination port ID"),
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> VoyageListResponse:
    """List voyages strictly scoped to the authenticated user's organization."""
    query = (
        db.query(Voyage)
        .join(Vessel, Voyage.vessel_id == Vessel.id)
        .filter(Vessel.organization_id == current_org.id)
    )

    if status_filter:
        query = query.filter(Voyage.status == status_filter.lower().strip())
    if vessel_id:
        query = query.filter(Voyage.vessel_id == vessel_id)
    if origin_port_id:
        query = query.filter(Voyage.origin_port_id == origin_port_id)
    if destination_port_id:
        query = query.filter(Voyage.destination_port_id == destination_port_id)

    total = query.count()
    offset = (page - 1) * page_size
    items = (
        query.order_by(Voyage.created_at.desc(), Voyage.id.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return VoyageListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{voyage_id}",
    response_model=VoyageRead,
    summary="Get voyage details by ID",
)
def get_voyage(
    voyage_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Voyage:
    """Retrieve full details of a voyage, including timeline events."""
    voyage = (
        db.query(Voyage)
        .options(selectinload(Voyage.events))
        .join(Vessel, Voyage.vessel_id == Vessel.id)
        .filter(
            Voyage.id == voyage_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not voyage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voyage not found",
        )
    return voyage


@router.patch(
    "/{voyage_id}",
    response_model=VoyageRead,
    summary="Update voyage details (partial update)",
)
def update_voyage(
    voyage_id: uuid.UUID,
    payload: VoyageUpdate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Voyage:
    """Update fields on an existing voyage with organization isolation and reference validation."""
    voyage = (
        db.query(Voyage)
        .options(selectinload(Voyage.events))
        .join(Vessel, Voyage.vessel_id == Vessel.id)
        .filter(
            Voyage.id == voyage_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not voyage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voyage not found",
        )

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return voyage

    # 1. Validate target vessel if updated
    target_vessel_id = updates.get("vessel_id", voyage.vessel_id)
    if "vessel_id" in updates and updates["vessel_id"] != voyage.vessel_id:
        vessel = (
            db.query(Vessel)
            .filter(
                Vessel.id == updates["vessel_id"],
                Vessel.organization_id == current_org.id,
            )
            .first()
        )
        if not vessel:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Vessel not found",
            )

    # 2. Validate ports if updated
    if "origin_port_id" in updates and updates["origin_port_id"] is not None:
        port = db.query(Port).filter(Port.id == updates["origin_port_id"]).first()
        if not port:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Origin port not found",
            )

    if "destination_port_id" in updates and updates["destination_port_id"] is not None:
        port = db.query(Port).filter(Port.id == updates["destination_port_id"]).first()
        if not port:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Destination port not found",
            )

    # 3. Check unique constraint collision if vessel_id or voyage_number is changed
    target_voyage_number = updates.get("voyage_number", voyage.voyage_number)
    if target_voyage_number:
        target_voyage_number = target_voyage_number.strip()

    if ("vessel_id" in updates or "voyage_number" in updates) and (
        target_vessel_id != voyage.vessel_id or target_voyage_number != voyage.voyage_number
    ):
        existing = (
            db.query(Voyage)
            .filter(
                Voyage.vessel_id == target_vessel_id,
                Voyage.voyage_number == target_voyage_number,
                Voyage.id != voyage.id,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Voyage '{target_voyage_number}' already exists for this vessel",
            )

    # 4. Apply partial updates
    for field, value in updates.items():
        if field == "status" and value is not None:
            setattr(voyage, field, value.lower().strip())
        elif field == "voyage_number" and value is not None:
            setattr(voyage, field, value.strip())
        elif field == "cargo_type" and value is not None:
            setattr(voyage, field, value.strip())
        else:
            setattr(voyage, field, value)

    try:
        db.commit()
        db.refresh(voyage)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to update voyage %s: %s", voyage_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update voyage record",
        ) from exc

    logger.info("Updated voyage %s (org: %s)", voyage.id, current_org.id)
    return voyage


@router.delete(
    "/{voyage_id}",
    response_model=VoyageDeleteResponse,
    summary="Delete a voyage (Admin and Manager only)",
)
def delete_voyage(
    voyage_id: uuid.UUID,
    current_user: User = Depends(require_manager_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> VoyageDeleteResponse:
    """Delete a voyage and its associated events. Restricted to Admin and Manager roles."""
    voyage = (
        db.query(Voyage)
        .join(Vessel, Voyage.vessel_id == Vessel.id)
        .filter(
            Voyage.id == voyage_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not voyage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voyage not found",
        )

    db.delete(voyage)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete voyage %s: %s", voyage_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete voyage record",
        ) from exc

    logger.info("Deleted voyage %s (org: %s)", voyage_id, current_org.id)
    return VoyageDeleteResponse(
        message="Voyage deleted successfully",
        voyage_id=voyage_id,
    )


# ─── Voyage Event Endpoints ──────────────────────────────────────────────────


@router.post(
    "/{voyage_id}/events",
    response_model=VoyageEventRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a timeline event for a voyage",
)
def create_voyage_event(
    voyage_id: uuid.UUID,
    payload: VoyageEventCreate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> VoyageEvent:
    """Create an operational or delay event for a voyage."""
    # 1. Verify parent voyage belongs to user's organization
    voyage = (
        db.query(Voyage)
        .join(Vessel, Voyage.vessel_id == Vessel.id)
        .filter(
            Voyage.id == voyage_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not voyage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voyage not found",
        )

    # 2. Verify port if supplied
    if payload.port_id:
        port = db.query(Port).filter(Port.id == payload.port_id).first()
        if not port:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Port not found",
            )

    # 3. Create event
    event = VoyageEvent(
        voyage_id=voyage_id,
        port_id=payload.port_id,
        event_type=payload.event_type.strip(),
        timestamp=payload.timestamp,
        end_timestamp=payload.end_timestamp,
        description=payload.description,
        is_delay=payload.is_delay,
        delay_reason=payload.delay_reason.strip() if payload.delay_reason else None,
        extra_metadata=payload.extra_metadata,
    )
    db.add(event)
    try:
        db.commit()
        db.refresh(event)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to commit voyage event: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist voyage event",
        ) from exc

    logger.info("Created event %s for voyage %s (org: %s)", event.id, voyage_id, current_org.id)
    return event


@router.get(
    "/{voyage_id}/events",
    response_model=VoyageEventListResponse,
    summary="List chronological events for a voyage",
)
def list_voyage_events(
    voyage_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> VoyageEventListResponse:
    """Retrieve all operational milestone and delay events for a voyage in chronological order."""
    # Verify parent voyage belongs to user's organization
    voyage = (
        db.query(Voyage)
        .join(Vessel, Voyage.vessel_id == Vessel.id)
        .filter(
            Voyage.id == voyage_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not voyage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voyage not found",
        )

    events = (
        db.query(VoyageEvent)
        .filter(VoyageEvent.voyage_id == voyage_id)
        .order_by(VoyageEvent.timestamp.asc(), VoyageEvent.created_at.asc())
        .all()
    )
    return VoyageEventListResponse(items=events, total=len(events))


@router.get(
    "/{voyage_id}/events/{event_id}",
    response_model=VoyageEventRead,
    summary="Get a specific voyage event by ID",
)
def get_voyage_event(
    voyage_id: uuid.UUID,
    event_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> VoyageEvent:
    """Retrieve details of a single voyage event."""
    # Verify parent voyage belongs to user's organization
    voyage = (
        db.query(Voyage)
        .join(Vessel, Voyage.vessel_id == Vessel.id)
        .filter(
            Voyage.id == voyage_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not voyage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voyage not found",
        )

    event = (
        db.query(VoyageEvent)
        .filter(
            VoyageEvent.id == event_id,
            VoyageEvent.voyage_id == voyage_id,
        )
        .first()
    )
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voyage event not found",
        )
    return event
