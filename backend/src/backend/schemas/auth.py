"""Authentication schemas and role definitions."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class UserRole(StrEnum):
    """Supported user roles within Maritime Nexus."""

    ADMIN = "admin"
    MANAGER = "manager"
    OPERATOR = "operator"
    ANALYST = "analyst"
    VIEWER = "viewer"


class FirebaseUser(BaseModel):
    """Decoded and verified Firebase user identity."""

    uid: str
    email: str | None = None
    email_verified: bool = False
    display_name: str | None = None


class UserProfileResponse(BaseModel):
    """Safe user profile response without tokens or credentials."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    firebase_uid: str
    email: str
    full_name: str | None = None
    role: str
    is_active: bool
    organization_id: uuid.UUID | None = None
    created_at: datetime
