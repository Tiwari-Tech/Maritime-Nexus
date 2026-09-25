"""Reusable FastAPI authorization dependencies.

Provides:
- get_current_user       : resolves Firebase token → synced local User
- get_current_org        : resolves the user's organization (403 if none)
- require_roles(...)     : factory returning a dependency that enforces roles

SECURITY:
- organization_id and role come exclusively from the database.
- Client-supplied organization IDs or role claims are never trusted.
- 401 for unauthenticated, 403 for insufficient authorization.
"""

import logging
import time
from collections.abc import Callable
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.exc import DatabaseError, OperationalError
from sqlalchemy.orm import Session

from backend.core.security import get_current_firebase_user
from backend.db.session import get_db
from backend.models.organization import Organization, User
from backend.schemas.auth import FirebaseUser, UserRole
from backend.services.user_sync import get_or_create_user

logger = logging.getLogger(__name__)


def get_current_user(
    request: Request,
    firebase_user: FirebaseUser = Depends(get_current_firebase_user),
    db: Session = Depends(get_db),
) -> User:
    """Resolve Firebase identity to a synchronized, active local User.

    Raises:
        HTTPException 401: if the user account is deactivated.
        HTTPException 503: if the database service is unavailable.
    """
    is_auth_me = request.url.path.endswith("/auth/me")
    t_sync_start = time.perf_counter()
    if is_auth_me:
        logger.info("Auth /me: database user sync started")

    try:
        user = get_or_create_user(db, firebase_user)
        t_sync = time.perf_counter() - t_sync_start
        if is_auth_me:
            logger.info("Auth /me: database user sync completed in %.3fs", t_sync)
    except (OperationalError, DatabaseError) as db_exc:
        t_sync = time.perf_counter() - t_sync_start
        logger.error(
            "Auth /me: database user sync failed after %.3fs: %s",
            t_sync,
            type(db_exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database service temporarily unavailable",
        ) from db_exc
    except RuntimeError as exc:
        t_sync = time.perf_counter() - t_sync_start
        if is_auth_me:
            logger.warning(
                "Auth /me: user synchronization error after %.3fs: %s",
                t_sync,
                exc,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not authorized",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not authorized",
        )

    return user


def get_current_org(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    """Resolve the authenticated user's organization from the database.

    Raises:
        HTTPException 403: if the user is not assigned to any organization.
    """
    if current_user.organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization access required",
        )

    # Fast path: organization already eagerly loaded with current_user
    org = current_user.organization
    if org is not None:
        if not org.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organization access required",
            )
        return org

    org = (
        db.query(Organization)
        .filter(
            Organization.id == current_user.organization_id,
            Organization.is_active.is_(True),
        )
        .first()
    )
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization access required",
        )
    return org


def require_roles(*roles: str) -> Callable[..., User]:
    """Dependency factory that restricts access to users with one of the given roles.

    Usage in a route:
        @router.get("/admin-only")
        def admin_route(user: User = Depends(require_roles("admin"))):
            ...

    Args:
        *roles: One or more role strings from UserRole.

    Returns:
        A FastAPI dependency that returns the current User or raises 403.
    """
    allowed: set[str] = set(roles)

    def _check_role(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return _check_role


# ─── Convenience pre-built role dependencies ──────────────────────────────────

require_admin: Callable[..., Any] = require_roles(UserRole.ADMIN)
require_manager_or_above: Callable[..., Any] = require_roles(UserRole.ADMIN, UserRole.MANAGER)
require_operator_or_above: Callable[..., Any] = require_roles(
    UserRole.ADMIN, UserRole.MANAGER, UserRole.OPERATOR
)
