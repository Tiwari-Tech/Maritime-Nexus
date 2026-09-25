"""Firebase ID token verification dependency.

Reads the Authorization: Bearer <token> header, verifies the token with
Firebase Admin SDK, and returns a validated FirebaseUser.

SECURITY:
- Never logs the raw token, refresh token, credentials, or secrets.
- Never exposes internal exceptions or credentials to clients.
- Logs specific verification failure categories on the server for diagnostics.
- Uses proper 401/403/503 HTTP status codes.
"""

import logging
import time

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth

from backend.core.config import settings
from backend.core.firebase import get_firebase_app
from backend.schemas.auth import FirebaseUser

logger = logging.getLogger(__name__)

# HTTPBearer: parses Authorization: Bearer <token> automatically
_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_firebase_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> FirebaseUser:
    """FastAPI dependency: verify Firebase ID token and return decoded identity.

    Uses Firebase Admin SDK's official verify_id_token() against Google public keys.
    Does not require stateful Identity Toolkit Admin API lookup (check_revoked=False).

    Raises:
        HTTPException 401: if Authorization header is missing, token is expired or invalid.
        HTTPException 503: if Google public key certificates cannot be fetched.
    """
    is_auth_me = request.url.path.endswith("/auth/me")
    if is_auth_me:
        request.state.auth_start_time = time.perf_counter()
        logger.info("Auth /me: request received")

    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials.strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Ensure Firebase App singleton is initialized for maritime-nexus
    try:
        app = get_firebase_app()
    except Exception as exc:
        logger.error(
            "Firebase Admin SDK initialization error: %s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service initialization error",
        ) from exc

    t_verify_start = time.perf_counter()
    if is_auth_me:
        logger.info("Auth /me: token verification started")

    try:
        # Standard cryptographic verification against Google public keys and project claims.
        # check_revoked=False verifies signature, exp, iat, aud, and iss without requiring
        # elevated Identity Toolkit IAM user-lookup permissions.
        decoded = auth.verify_id_token(token, app=app, check_revoked=False)
        t_verify = time.perf_counter() - t_verify_start
        if is_auth_me:
            logger.info("Auth /me: token verification completed in %.3fs", t_verify)

    except auth.ExpiredIdTokenError:
        logger.warning("Firebase ID token verification failed: Token has expired")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )

    except auth.RevokedIdTokenError:
        logger.warning("Firebase ID token verification failed: Token has been revoked")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    except auth.CertificateFetchError as exc:
        logger.error(
            "Firebase ID token verification failed: Public key certificate fetch error: %s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
            headers={"WWW-Authenticate": "Bearer"},
        )

    except auth.UserDisabledError:
        logger.warning("Firebase ID token verification failed: User account is disabled")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )

    except auth.InvalidIdTokenError as exc:
        exc_str = str(exc).lower()
        if "audience" in exc_str or "project" in exc_str:
            logger.warning(
                "Firebase ID token verification failed: Token audience does not match project '%s'",
                settings.FIREBASE_PROJECT_ID,
            )
        elif "issuer" in exc_str:
            logger.warning("Firebase ID token verification failed: Token issuer is invalid")
        elif "signature" in exc_str:
            logger.warning("Firebase ID token verification failed: Token signature is invalid")
        else:
            logger.warning("Firebase ID token verification failed: Invalid token format or claims")

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    except ValueError:
        logger.warning("Firebase ID token verification failed: Malformed or empty token string")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    except Exception as exc:
        # Catch-all: log error class without logging token contents
        logger.error(
            "Unexpected error during Firebase token verification: %s",
            type(exc).__name__,
        )
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
