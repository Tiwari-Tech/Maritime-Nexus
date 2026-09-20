"""Firebase ID token verification dependency.

Reads the Authorization: Bearer <token> header, verifies the token with
Firebase Admin SDK, and returns a validated FirebaseUser.

SECURITY:
- Never logs the raw token.
- Never exposes raw Firebase exception messages to clients.
- Uses proper 401/403 HTTP status codes.
"""

import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.core.firebase import get_firebase_app
from backend.schemas.auth import FirebaseUser
from firebase_admin import auth

logger = logging.getLogger(__name__)

# HTTPBearer: rejects requests without Authorization: Bearer <token> automatically
_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_firebase_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> FirebaseUser:
    """FastAPI dependency: verify Firebase ID token and return decoded identity.

    Raises:
        HTTPException 401: if Authorization header is missing or token is invalid.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # Ensure Firebase App is initialized
    get_firebase_app()

    try:
        decoded = auth.verify_id_token(token, check_revoked=True)
    except auth.RevokedIdTokenError:
        logger.warning("Firebase token has been revoked (uid redacted)")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except auth.ExpiredIdTokenError:
        logger.warning("Firebase token has expired")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except auth.InvalidIdTokenError:
        logger.warning("Firebase token failed validation")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception:
        # Catch-all: do not surface internal exception messages to clients
        logger.warning("Unexpected error during Firebase token verification")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return FirebaseUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        email_verified=decoded.get("email_verified", False),
        display_name=decoded.get("name"),
    )
