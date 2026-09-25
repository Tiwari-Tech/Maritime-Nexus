"""Vessel Management API routes for Maritime Nexus.

Endpoints for authenticated vessel fleet registration, listing, retrieval,
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
from backend.models.vessel import Vessel
from backend.models.voyage import Voyage
from backend.schemas.vessel import (
    VesselCreate,
    VesselDeleteResponse,
    VesselListResponse,
    VesselRead,
    VesselUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vessels", tags=["Vessels"])


# ─── Vessel CRUD Endpoints ───────────────────────────────────────────────────


@router.post(
    "",
    response_model=VesselRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new vessel in fleet",
)
def create_vessel(
    payload: VesselCreate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Vessel:
    """Register a new vessel under the authenticated user's organization.

    - Organization ownership is determined exclusively by the authenticated user's context.
    - Validates global uniqueness of IMO number (409 Conflict if duplicate).
    - Requires Operator role or above.
    """
    clean_imo = payload.imo_number.strip().upper()
    clean_name = payload.name.strip()
    clean_type = payload.vessel_type.strip()

    # 1. Enforce global uniqueness constraint on IMO number
    existing = db.query(Vessel).filter(Vessel.imo_number == clean_imo).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Vessel with IMO number '{clean_imo}' already exists",
        )

    # 2. Instantiate and persist vessel
    vessel = Vessel(
        organization_id=current_org.id,
        imo_number=clean_imo,
        name=clean_name,
        vessel_type=clean_type,
        flag=payload.flag.strip() if payload.flag else None,
        call_sign=payload.call_sign.strip().upper() if payload.call_sign else None,
        mmsi=payload.mmsi.strip() if payload.mmsi else None,
        deadweight_tonnage=payload.deadweight_tonnage,
        gross_tonnage=payload.gross_tonnage,
        year_built=payload.year_built,
        status=payload.status.lower().strip() if payload.status else "active",
    )
    db.add(vessel)
    try:
        db.commit()
        db.refresh(vessel)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to commit vessel: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist vessel record",
        ) from exc

    logger.info("Created vessel %s (%s) for org %s", vessel.id, clean_imo, current_org.id)
    return vessel


@router.get(
    "",
    response_model=VesselListResponse,
    summary="List organization vessels with filtering and pagination",
)
def list_vessels(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    status_filter: str | None = Query(
        None,
        alias="status",
        description="Filter by vessel status (e.g. active, in_drydock, laid_up, decommissioned)",
    ),
    vessel_type: str | None = Query(None, description="Filter by vessel type/classification"),
    flag: str | None = Query(None, description="Filter by flag state"),
    imo_number: str | None = Query(None, description="Filter by exact IMO number"),
    search: str | None = Query(None, description="Search across vessel name, IMO number, or call sign"),
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> VesselListResponse:
    """Retrieve vessels strictly scoped to the authenticated user's organization."""
    query = db.query(Vessel).filter(Vessel.organization_id == current_org.id)

    if status_filter:
        query = query.filter(Vessel.status == status_filter.lower().strip())
    if vessel_type:
        query = query.filter(Vessel.vessel_type.ilike(f"%{vessel_type.strip()}%"))
    if flag:
        query = query.filter(Vessel.flag.ilike(f"%{flag.strip()}%"))
    if imo_number:
        query = query.filter(Vessel.imo_number == imo_number.strip().upper())
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Vessel.name.ilike(term),
                Vessel.imo_number.ilike(term),
                Vessel.call_sign.ilike(term),
            )
        )

    total = query.count()
    offset = (page - 1) * page_size
    items = (
        query.order_by(Vessel.created_at.desc(), Vessel.id.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return VesselListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{vessel_id}",
    response_model=VesselRead,
    summary="Get vessel details by ID",
)
def get_vessel(
    vessel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Vessel:
    """Retrieve full details of a single vessel within the user's organization."""
    vessel = (
        db.query(Vessel)
        .filter(
            Vessel.id == vessel_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not vessel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vessel not found",
        )
    return vessel


@router.patch(
    "/{vessel_id}",
    response_model=VesselRead,
    summary="Update vessel particulars (partial update)",
)
def update_vessel(
    vessel_id: uuid.UUID,
    payload: VesselUpdate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Vessel:
    """Update fields on an existing vessel with tenant isolation and uniqueness validation."""
    vessel = (
        db.query(Vessel)
        .filter(
            Vessel.id == vessel_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not vessel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vessel not found",
        )

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return vessel

    # 1. Enforce unique IMO number constraint if updated
    if "imo_number" in updates and updates["imo_number"] is not None:
        clean_imo = updates["imo_number"].strip().upper()
        if clean_imo != vessel.imo_number:
            existing = (
                db.query(Vessel)
                .filter(
                    Vessel.imo_number == clean_imo,
                    Vessel.id != vessel.id,
                )
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Vessel with IMO number '{clean_imo}' already exists",
                )
        updates["imo_number"] = clean_imo

    # 2. Apply updates
    for field, value in updates.items():
        if field == "status" and value is not None:
            setattr(vessel, field, value.lower().strip())
        elif field in ("name", "vessel_type", "flag") and value is not None:
            setattr(vessel, field, value.strip())
        elif field == "call_sign" and value is not None:
            setattr(vessel, field, value.strip().upper())
        elif field == "mmsi" and value is not None:
            setattr(vessel, field, value.strip())
        else:
            setattr(vessel, field, value)

    try:
        db.commit()
        db.refresh(vessel)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to update vessel %s: %s", vessel_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update vessel record",
        ) from exc

    logger.info("Updated vessel %s (org: %s)", vessel.id, current_org.id)
    return vessel


@router.delete(
    "/{vessel_id}",
    response_model=VesselDeleteResponse,
    summary="Delete a vessel (Admin and Manager only)",
)
def delete_vessel(
    vessel_id: uuid.UUID,
    current_user: User = Depends(require_manager_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> VesselDeleteResponse:
    """Delete a vessel. Restricted to Admin and Manager roles.

    Operational safeguard: If existing voyages reference this vessel, deletion
    is rejected with 409 Conflict to protect operational and timeline history.
    """
    vessel = (
        db.query(Vessel)
        .filter(
            Vessel.id == vessel_id,
            Vessel.organization_id == current_org.id,
        )
        .first()
    )
    if not vessel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vessel not found",
        )

    # Operational history protection: prevent deletion if voyages reference this vessel
    voyage_count = db.query(Voyage).filter(Voyage.vessel_id == vessel_id).count()
    if voyage_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete vessel with existing voyage records. Operational history must be preserved.",
        )

    db.delete(vessel)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete vessel %s: %s", vessel_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete vessel record",
        ) from exc

    logger.info("Deleted vessel %s (org: %s)", vessel_id, current_org.id)
    return VesselDeleteResponse(
        message="Vessel deleted successfully",
        vessel_id=vessel_id,
    )
