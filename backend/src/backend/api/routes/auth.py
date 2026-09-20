"""Authentication API routes.

Provides the /api/v1/auth/me endpoint which returns the authenticated user's
safe profile data. No tokens, passwords, or credentials are ever returned.
"""

from fastapi import APIRouter, Depends

from backend.api.dependencies import get_current_user
from backend.models.organization import User
from backend.schemas.auth import UserProfileResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Get current authenticated user profile",
)
def get_me(current_user: User = Depends(get_current_user)) -> User:
    """Return safe profile information for the authenticated user.

    Requires: Authorization: Bearer <Firebase ID Token>

    Returns:
        - id (local database UUID)
        - firebase_uid
        - email
        - full_name
        - role (from database — never from token)
        - is_active
        - organization_id (from database — never from token)
        - created_at

    Never returns tokens, passwords, service-account paths, or secrets.
    """
    return current_user
