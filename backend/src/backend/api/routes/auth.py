"""Authentication API routes.

Provides the /api/v1/auth/me endpoint which returns the authenticated user's
safe profile data. No tokens, passwords, or credentials are ever returned.
"""

import logging
import time

from fastapi import APIRouter, Depends, Request

from backend.api.dependencies import get_current_user
from backend.models.organization import User
from backend.schemas.auth import UserProfileResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Get current authenticated user profile",
)
def get_me(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> User:
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
    """
    start_time = getattr(request.state, "auth_start_time", None)
    if start_time is not None:
        total_time = time.perf_counter() - start_time
        logger.info("Auth /me: response generated (total: %.3fs)", total_time)
    else:
        logger.info("Auth /me: response generated")
    return current_user
