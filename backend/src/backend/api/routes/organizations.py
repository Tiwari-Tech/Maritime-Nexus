"""Organization onboarding and management API routes for Maritime Nexus."""

import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.api.dependencies import get_current_user
from backend.db.session import get_db
from backend.models.organization import Organization, User
from backend.schemas.auth import UserRole
from backend.schemas.organization import OrganizationCreate, OrganizationResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/organizations", tags=["Organizations"])


def generate_unique_slug(name: str, db: Session) -> str:
    """Generate a URL-safe unique slug for an organization."""
    base_slug = re.sub(r"[^\w\s-]", "", name.lower().strip())
    base_slug = re.sub(r"[\s_-]+", "-", base_slug).strip("-")[:80] or "org"

    slug = base_slug
    collision = db.query(Organization).filter(Organization.slug == slug).first()
    if collision:
        slug = f"{base_slug[:70]}-{uuid.uuid4().hex[:8]}"

    return slug


@router.post(
    "",
    response_model=OrganizationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create and onboard into a new organization",
)
def create_organization(
    payload: OrganizationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    """Create a new organization and associate the authenticated user as its administrator.

    - Requires valid Firebase ID token authentication.
    - If the user already belongs to an organization, rejects with 409 Conflict.
    - Sets current_user.organization_id to the new organization.
    - Promotes current_user.role to 'admin'.
    - Returns the created organization metadata.
    """
    clean_name = payload.name.strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization name cannot be empty",
        )

    # 1. Prevent duplicate organization creation for an already onboarded user
    if current_user.organization_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already belongs to an organization",
        )

    slug = generate_unique_slug(clean_name, db)
    org_id = uuid.uuid4()

    org = Organization(
        id=org_id,
        name=clean_name,
        slug=slug,
        is_active=True,
    )

    try:
        db.add(org)

        # 2. Link user to organization and assign admin role
        current_user.organization_id = org.id
        current_user.role = UserRole.ADMIN

        db.commit()
        db.refresh(org)
        db.refresh(current_user)

        logger.info(
            "Successfully created organization %s (%s) and assigned user %s as admin",
            org.name,
            org.id,
            current_user.id,
        )
        return org

    except IntegrityError as exc:
        db.rollback()
        logger.error("Database integrity error creating organization: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An organization with this slug or name already exists",
        ) from exc
    except Exception as exc:
        db.rollback()
        logger.error("Failed to create organization: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create organization",
        ) from exc
