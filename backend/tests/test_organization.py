"""Tests for organization onboarding and authorization."""

import uuid
from datetime import datetime, timezone

from fastapi import status
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_user
from backend.db.session import get_db
from backend.main import app
from backend.models.organization import User
from backend.schemas.auth import UserRole

client = TestClient(app)


class MockSession:
    """Mock database session for lightweight route testing."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)
        if hasattr(obj, "created_at") and obj.created_at is None:
            obj.created_at = datetime.now(timezone.utc)

    def commit(self):
        pass

    def refresh(self, obj):
        pass

    def rollback(self):
        pass

    def query(self, model):
        class Query:
            def filter(self, *args, **kwargs):
                return self

            def first(self):
                return None

        return Query()


def test_unauthenticated_organization_creation():
    """Unauthenticated request to create an organization must return 401."""
    res = client.post("/api/v1/organizations", json={"name": "Test Org"})
    assert res.status_code == status.HTTP_401_UNAUTHORIZED


def test_create_organization_success():
    """Authenticated user without an organization creates one and becomes admin."""
    fake_user = User(
        id=uuid.uuid4(),
        firebase_uid="test_uid_123",
        email="test_onboarding@maritime-nexus.com",
        full_name="Test User",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=None,
        created_at=datetime.now(timezone.utc),
    )

    mock_db = MockSession()
    app.dependency_overrides[get_current_user] = lambda: fake_user
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        res = client.post(
            "/api/v1/organizations",
            json={"name": "Maritime Nexus Demo Organization"},
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        assert data["name"] == "Maritime Nexus Demo Organization"
        assert data["slug"] == "maritime-nexus-demo-organization"
        assert fake_user.organization_id is not None
        assert fake_user.role == UserRole.ADMIN

        # Verify auth/me reflects the new organization and role
        me_res = client.get("/api/v1/auth/me")
        assert me_res.status_code == 200
        me_data = me_res.json()
        assert me_data["organization_id"] == str(fake_user.organization_id)
        assert me_data["role"] == "admin"

    finally:
        app.dependency_overrides.clear()


def test_duplicate_organization_creation_rejected():
    """Authenticated user who already belongs to an organization receives 409 Conflict."""
    existing_org_id = uuid.uuid4()
    user_with_org = User(
        id=uuid.uuid4(),
        firebase_uid="test_uid_456",
        email="existing_org_user@maritime-nexus.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=existing_org_id,
        created_at=datetime.now(timezone.utc),
    )

    mock_db = MockSession()
    app.dependency_overrides[get_current_user] = lambda: user_with_org
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        res = client.post(
            "/api/v1/organizations",
            json={"name": "Another Organization"},
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert res.json()["detail"] == "User already belongs to an organization"
    finally:
        app.dependency_overrides.clear()


def test_documents_requires_organization():
    """User without an organization must receive 403 on organization-scoped document endpoints."""
    user_without_org = User(
        id=uuid.uuid4(),
        firebase_uid="no_org_uid",
        email="no_org@maritime-nexus.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=None,
        created_at=datetime.now(timezone.utc),
    )

    app.dependency_overrides[get_current_user] = lambda: user_without_org
    try:
        res = client.get("/api/v1/documents")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["detail"] == "Organization access required"
    finally:
        app.dependency_overrides.clear()
