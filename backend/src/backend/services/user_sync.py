"""User synchronization service.

Maps a verified Firebase identity to a local database User record.

SECURITY RULES enforced here:
- organization_id, role, is_active are NEVER read from the Firebase token.
- These values come exclusively from the local PostgreSQL database.
- Default role is 'viewer' — the least privileged role.
- New users are created WITHOUT an organization until one is assigned by an admin.
- SQLAlchemy IntegrityError (duplicate uid/email race) is handled with rollback.
"""

import logging
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.models.organization import User
from backend.schemas.auth import FirebaseUser, UserRole

logger = logging.getLogger(__name__)


def get_or_create_user(db: Session, firebase_user: FirebaseUser) -> User:
    """Synchronize Firebase identity with the local User record.

    - If the local user exists: update only safe identity fields (email, full_name).
    - If the local user does not exist: create with role=viewer, no organization.

    Args:
        db: Active SQLAlchemy session.
        firebase_user: Verified Firebase identity from token.

    Returns:
        The up-to-date local User database record.

    Raises:
        RuntimeError: If a Firebase user has no email (required for our schema).
    """
    if not firebase_user.email:
        logger.warning("Firebase user uid=... has no email — cannot synchronize")
        raise RuntimeError("Firebase user has no email address")

    # Lookup by firebase_uid (the stable identity key)
    user: User | None = (
        db.query(User)
        .filter(User.firebase_uid == firebase_user.uid)
        .first()
    )

    if user is not None:
        # Update only safe identity fields — never touch role, organization, or is_active
        changed = False
        if user.email != firebase_user.email:
            user.email = firebase_user.email
            changed = True
        if firebase_user.display_name and user.full_name != firebase_user.display_name:
            user.full_name = firebase_user.display_name
            changed = True
        if changed:
            try:
                db.commit()
                db.refresh(user)
            except IntegrityError:
                db.rollback()
                logger.warning(
                    "IntegrityError updating user identity fields (uid redacted); re-fetching"
                )
                user = db.query(User).filter(User.firebase_uid == firebase_user.uid).first()
        return user  # type: ignore[return-value]

    # --- Create new user ---
    new_user = User(
        id=uuid.uuid4(),
        firebase_uid=firebase_user.uid,
        email=firebase_user.email,
        full_name=firebase_user.display_name,
        role=UserRole.VIEWER,       # least-privileged default
        is_active=True,
        organization_id=None,       # admin must assign an organization
    )
    db.add(new_user)
    try:
        db.commit()
        db.refresh(new_user)
        logger.info("Created new local user record (role=viewer, no organization)")
    except IntegrityError:
        db.rollback()
        # Race condition: another request already created the user — fetch it
        logger.warning(
            "IntegrityError creating user (uid redacted) — likely a race condition; re-fetching"
        )
        new_user = db.query(User).filter(User.firebase_uid == firebase_user.uid).first()
        if new_user is None:
            raise RuntimeError("User synchronization failed after IntegrityError")

    return new_user
