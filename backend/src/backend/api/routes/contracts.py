"""Contract and ContractClause Management API routes for Maritime Nexus.

Endpoints for authenticated commercial fixture registration, listing, retrieval,
partial update, safe deletion, and clause hierarchy management.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from backend.api.dependencies import (
    get_current_org,
    get_current_user,
    require_manager_or_above,
    require_operator_or_above,
)
from backend.db.session import get_db
from backend.models.contract import Contract, ContractClause
from backend.models.document import Document
from backend.models.document_chunk import DocumentChunk
from backend.models.organization import Organization, User
from backend.models.vessel import Vessel
from backend.models.voyage import Voyage
from backend.schemas.contract import (
    ContractClauseCreate,
    ContractClauseDeleteResponse,
    ContractClauseListResponse,
    ContractClauseRead,
    ContractClauseUpdate,
    ContractCreate,
    ContractDeleteResponse,
    ContractListResponse,
    ContractRead,
    ContractUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contracts", tags=["Contracts"])


# ─── Contract CRUD Endpoints ─────────────────────────────────────────────────


@router.post(
    "",
    response_model=ContractRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new commercial contract",
)
def create_contract(
    payload: ContractCreate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Contract:
    """Create a new commercial charter party or contract strictly scoped to the user's organization."""
    clean_ref = payload.contract_reference.strip()

    # 1. Enforce unique contract_reference per organization
    existing = (
        db.query(Contract)
        .filter(
            Contract.organization_id == current_org.id,
            Contract.contract_reference == clean_ref,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Contract with reference '{clean_ref}' already exists in this organization",
        )

    # 2. Validate document association if supplied
    if payload.document_id:
        doc = (
            db.query(Document)
            .filter(
                Document.id == payload.document_id,
                Document.organization_id == current_org.id,
            )
            .first()
        )
        if not doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced document not found within organization",
            )

    # 3. Validate vessel association if supplied
    if payload.vessel_id:
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
                detail="Referenced vessel not found within organization",
            )

    # 4. Validate voyage association if supplied
    if payload.voyage_id:
        voyage = (
            db.query(Voyage)
            .join(Vessel, Voyage.vessel_id == Vessel.id)
            .filter(
                Voyage.id == payload.voyage_id,
                Vessel.organization_id == current_org.id,
            )
            .first()
        )
        if not voyage:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced voyage not found within organization",
            )

    # 5. Instantiate and persist contract
    contract = Contract(
        organization_id=current_org.id,
        document_id=payload.document_id,
        vessel_id=payload.vessel_id,
        voyage_id=payload.voyage_id,
        contract_reference=clean_ref,
        contract_type=payload.contract_type.strip(),
        charterer=payload.charterer.strip() if payload.charterer else None,
        owner=payload.owner.strip() if payload.owner else None,
        broker=payload.broker.strip() if payload.broker else None,
        commencement_date=payload.commencement_date,
        expiration_date=payload.expiration_date,
        demurrage_rate_daily=payload.demurrage_rate_daily,
        despatch_rate_daily=payload.despatch_rate_daily,
        laytime_allowed_hours=payload.laytime_allowed_hours,
        status=payload.status.lower().strip() if payload.status else "active",
        extra_metadata=payload.extra_metadata,
    )
    db.add(contract)
    try:
        db.commit()
        db.refresh(contract)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to commit contract: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist contract record",
        ) from exc

    logger.info("Created contract %s (%s) for org %s", contract.id, clean_ref, current_org.id)
    return contract


@router.get(
    "",
    response_model=ContractListResponse,
    summary="List organization contracts with filtering and pagination",
)
def list_contracts(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    status_filter: str | None = Query(None, alias="status", description="Filter by contract status"),
    contract_type: str | None = Query(None, description="Filter by contract type"),
    document_id: uuid.UUID | None = Query(None, description="Filter by document ID"),
    vessel_id: uuid.UUID | None = Query(None, description="Filter by vessel ID"),
    search: str | None = Query(None, description="Search reference, charterer, owner, or broker"),
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> ContractListResponse:
    """Retrieve contracts strictly scoped to the authenticated user's organization."""
    query = db.query(Contract).filter(Contract.organization_id == current_org.id)

    if status_filter:
        query = query.filter(Contract.status == status_filter.lower().strip())
    if contract_type:
        query = query.filter(Contract.contract_type.ilike(f"%{contract_type.strip()}%"))
    if document_id:
        query = query.filter(Contract.document_id == document_id)
    if vessel_id:
        query = query.filter(Contract.vessel_id == vessel_id)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Contract.contract_reference.ilike(term),
                Contract.charterer.ilike(term),
                Contract.owner.ilike(term),
                Contract.broker.ilike(term),
            )
        )

    total = query.count()
    offset = (page - 1) * page_size
    items = (
        query.order_by(Contract.created_at.desc(), Contract.id.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return ContractListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{contract_id}",
    response_model=ContractRead,
    summary="Get contract details with embedded clauses",
)
def get_contract(
    contract_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Contract:
    """Retrieve full details of a single contract including clauses, scoped to the caller's organization."""
    contract = (
        db.query(Contract)
        .options(selectinload(Contract.clauses))
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )
    return contract


@router.patch(
    "/{contract_id}",
    response_model=ContractRead,
    summary="Update contract details (partial update)",
)
def update_contract(
    contract_id: uuid.UUID,
    payload: ContractUpdate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> Contract:
    """Update fields on an existing contract with tenant isolation and relationship validation."""
    contract = (
        db.query(Contract)
        .options(selectinload(Contract.clauses))
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return contract

    # 1. Validate logical date relationship against updated or existing dates
    target_commencement = updates.get("commencement_date", contract.commencement_date)
    target_expiration = updates.get("expiration_date", contract.expiration_date)
    if target_commencement and target_expiration and target_expiration < target_commencement:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="expiration_date cannot be earlier than commencement_date",
        )

    # 2. Enforce unique contract_reference per organization if changed
    if "contract_reference" in updates and updates["contract_reference"] is not None:
        clean_ref = updates["contract_reference"].strip()
        if clean_ref != contract.contract_reference:
            existing = (
                db.query(Contract)
                .filter(
                    Contract.organization_id == current_org.id,
                    Contract.contract_reference == clean_ref,
                    Contract.id != contract.id,
                )
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Contract with reference '{clean_ref}' already exists in this organization",
                )
        updates["contract_reference"] = clean_ref

    # 2. Validate document association if updated
    if "document_id" in updates and updates["document_id"] is not None:
        doc = (
            db.query(Document)
            .filter(
                Document.id == updates["document_id"],
                Document.organization_id == current_org.id,
            )
            .first()
        )
        if not doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced document not found within organization",
            )

    # 3. Validate vessel association if updated
    if "vessel_id" in updates and updates["vessel_id"] is not None:
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
                detail="Referenced vessel not found within organization",
            )

    # 4. Validate voyage association if updated
    if "voyage_id" in updates and updates["voyage_id"] is not None:
        voyage = (
            db.query(Voyage)
            .join(Vessel, Voyage.vessel_id == Vessel.id)
            .filter(
                Voyage.id == updates["voyage_id"],
                Vessel.organization_id == current_org.id,
            )
            .first()
        )
        if not voyage:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced voyage not found within organization",
            )

    # 5. Apply updates
    for field, value in updates.items():
        if field == "status" and value is not None:
            setattr(contract, field, value.lower().strip())
        elif field in ("contract_type", "charterer", "owner", "broker") and value is not None:
            setattr(contract, field, value.strip())
        else:
            setattr(contract, field, value)

    try:
        db.commit()
        db.refresh(contract)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to update contract %s: %s", contract_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update contract record",
        ) from exc

    logger.info("Updated contract %s (org: %s)", contract.id, current_org.id)
    return contract


@router.delete(
    "/{contract_id}",
    response_model=ContractDeleteResponse,
    summary="Delete a contract (Admin and Manager only)",
)
def delete_contract(
    contract_id: uuid.UUID,
    current_user: User = Depends(require_manager_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> ContractDeleteResponse:
    """Delete a contract and cascade delete its child clauses.

    Leaves referenced Documents, Vessels, and Voyages completely intact.
    """
    contract = (
        db.query(Contract)
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )

    db.delete(contract)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete contract %s: %s", contract_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete contract record",
        ) from exc

    logger.info("Deleted contract %s (org: %s)", contract_id, current_org.id)
    return ContractDeleteResponse(
        message="Contract deleted successfully",
        contract_id=contract_id,
    )


# ─── Contract Clause Endpoints ───────────────────────────────────────────────


@router.post(
    "/{contract_id}/clauses",
    response_model=ContractClauseRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a clause under a contract",
)
def create_contract_clause(
    contract_id: uuid.UUID,
    payload: ContractClauseCreate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> ContractClause:
    """Add a contractual clause to an existing contract belonging to the caller's organization."""
    # 1. Verify parent contract ownership
    contract = (
        db.query(Contract)
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )

    # 2. Validate document chunk linkage if supplied
    if payload.document_chunk_id:
        chunk = (
            db.query(DocumentChunk)
            .join(Document, DocumentChunk.document_id == Document.id)
            .filter(
                DocumentChunk.id == payload.document_chunk_id,
                Document.organization_id == current_org.id,
            )
            .first()
        )
        if not chunk:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced document chunk not found within organization",
            )

    # 3. Instantiate and persist clause
    clause = ContractClause(
        contract_id=contract_id,
        document_chunk_id=payload.document_chunk_id,
        clause_number=payload.clause_number.strip(),
        clause_title=payload.clause_title.strip() if payload.clause_title else None,
        clause_type=payload.clause_type.strip(),
        clause_text=payload.clause_text.strip(),
        order_index=payload.order_index,
        extra_metadata=payload.extra_metadata,
    )
    db.add(clause)
    try:
        db.commit()
        db.refresh(clause)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to commit contract clause: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist contract clause",
        ) from exc

    logger.info("Created clause %s for contract %s (org: %s)", clause.id, contract_id, current_org.id)
    return clause


@router.get(
    "/{contract_id}/clauses",
    response_model=ContractClauseListResponse,
    summary="List clauses belonging to a contract",
)
def list_contract_clauses(
    contract_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> ContractClauseListResponse:
    """Retrieve all clauses for a contract in deterministic sequence order."""
    # Verify parent contract ownership
    contract = (
        db.query(Contract)
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )

    clauses = (
        db.query(ContractClause)
        .filter(ContractClause.contract_id == contract_id)
        .order_by(ContractClause.order_index.asc(), ContractClause.created_at.asc())
        .all()
    )
    return ContractClauseListResponse(items=clauses, total=len(clauses))


@router.get(
    "/{contract_id}/clauses/{clause_id}",
    response_model=ContractClauseRead,
    summary="Get a single contract clause by ID",
)
def get_contract_clause(
    contract_id: uuid.UUID,
    clause_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> ContractClause:
    """Retrieve details of a single clause belonging to an organization contract."""
    # Verify parent contract ownership
    contract = (
        db.query(Contract)
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )

    clause = (
        db.query(ContractClause)
        .filter(
            ContractClause.id == clause_id,
            ContractClause.contract_id == contract_id,
        )
        .first()
    )
    if not clause:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract clause not found",
        )
    return clause


@router.patch(
    "/{contract_id}/clauses/{clause_id}",
    response_model=ContractClauseRead,
    summary="Update a contract clause (partial update)",
)
def update_contract_clause(
    contract_id: uuid.UUID,
    clause_id: uuid.UUID,
    payload: ContractClauseUpdate,
    current_user: User = Depends(require_operator_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> ContractClause:
    """Update fields on a contract clause with parent and tenant isolation."""
    # 1. Verify parent contract ownership
    contract = (
        db.query(Contract)
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )

    clause = (
        db.query(ContractClause)
        .filter(
            ContractClause.id == clause_id,
            ContractClause.contract_id == contract_id,
        )
        .first()
    )
    if not clause:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract clause not found",
        )

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return clause

    # 2. Validate document chunk linkage if updated
    if "document_chunk_id" in updates and updates["document_chunk_id"] is not None:
        chunk = (
            db.query(DocumentChunk)
            .join(Document, DocumentChunk.document_id == Document.id)
            .filter(
                DocumentChunk.id == updates["document_chunk_id"],
                Document.organization_id == current_org.id,
            )
            .first()
        )
        if not chunk:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Referenced document chunk not found within organization",
            )

    # 3. Apply updates
    for field, value in updates.items():
        if field in ("clause_number", "clause_title", "clause_type", "clause_text") and value is not None:
            setattr(clause, field, value.strip())
        else:
            setattr(clause, field, value)

    try:
        db.commit()
        db.refresh(clause)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to update clause %s: %s", clause_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update contract clause",
        ) from exc

    logger.info("Updated clause %s under contract %s (org: %s)", clause_id, contract_id, current_org.id)
    return clause


@router.delete(
    "/{contract_id}/clauses/{clause_id}",
    response_model=ContractClauseDeleteResponse,
    summary="Delete a contract clause (Admin and Manager only)",
)
def delete_contract_clause(
    contract_id: uuid.UUID,
    clause_id: uuid.UUID,
    current_user: User = Depends(require_manager_or_above),
    current_org: Organization = Depends(get_current_org),
    db: Session = Depends(get_db),
) -> ContractClauseDeleteResponse:
    """Delete a single contract clause. Preserves parent contract and source documents."""
    # Verify parent contract ownership
    contract = (
        db.query(Contract)
        .filter(
            Contract.id == contract_id,
            Contract.organization_id == current_org.id,
        )
        .first()
    )
    if not contract:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract not found",
        )

    clause = (
        db.query(ContractClause)
        .filter(
            ContractClause.id == clause_id,
            ContractClause.contract_id == contract_id,
        )
        .first()
    )
    if not clause:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contract clause not found",
        )

    db.delete(clause)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete clause %s: %s", clause_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete contract clause",
        ) from exc

    logger.info("Deleted clause %s under contract %s (org: %s)", clause_id, contract_id, current_org.id)
    return ContractClauseDeleteResponse(
        message="Contract clause deleted successfully",
        clause_id=clause_id,
    )
