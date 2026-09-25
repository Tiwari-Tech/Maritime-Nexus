"""Comprehensive automated tests for Vessel Management API.

Tests cover:
- 401 Unauthenticated access across all vessel endpoints
- 403 Forbidden for users without an organization
- RBAC role enforcement (Viewer, Operator, Manager, Admin)
- Data validation (422 Unprocessable Entity for negative tonnage or invalid payload)
- Uniqueness collision handling (409 Conflict for duplicate IMO numbers across fleet)
- Full CRUD lifecycle for vessels
- Filtering, text search, and pagination for vessel listings
- Strict multi-tenant organization isolation (cross-tenant access yields 404)
- Voyage operational history protection (409 Conflict on delete if voyages exist)
"""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.dependencies import get_current_org, get_current_user
from backend.db.session import get_db
from backend.main import app
from backend.models.base import Base
from backend.models.organization import Organization, User
from backend.models.port import Port
from backend.models.vessel import Vessel
from backend.models.voyage import Voyage
from backend.schemas.auth import UserRole

# Ensure SQLite treats PostgreSQL JSONB as native JSON during test execution
compiles(JSONB, "sqlite")(lambda type_, compiler, **kw: "JSON")

client = TestClient(app)


# ─── Test Database & Fixtures ───────────────────────────────────────────────


@pytest.fixture
def db_session():
    """Create a pristine in-memory SQLite database session for each test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seed_data(db_session):
    """Seed initial organizations, users with varying roles, ports, and vessels."""
    # Org A (Primary)
    org_a = Organization(
        id=uuid.uuid4(),
        name="Global Maritime Group",
        slug="global-maritime",
        is_active=True,
    )
    # Org B (Isolated Peer)
    org_b = Organization(
        id=uuid.uuid4(),
        name="Nordic Carrier Line",
        slug="nordic-carrier",
        is_active=True,
    )
    db_session.add_all([org_a, org_b])

    # Global Port for Voyage compatibility test
    port_rtm = Port(
        id=uuid.uuid4(),
        unlocode="NLRTM",
        name="Rotterdam",
        country="Netherlands",
        country_code="NL",
    )
    db_session.add(port_rtm)

    # Pre-existing Vessels
    vessel_a = Vessel(
        id=uuid.uuid4(),
        organization_id=org_a.id,
        imo_number="IMO9123456",
        name="Pacific Voyager",
        vessel_type="Bulk Carrier",
        flag="Panama",
        call_sign="3EAA2",
        mmsi="351234567",
        deadweight_tonnage=75000.0,
        gross_tonnage=42000.0,
        year_built=2018,
        status="active",
    )
    vessel_b = Vessel(
        id=uuid.uuid4(),
        organization_id=org_b.id,
        imo_number="IMO9654321",
        name="Nordic Pioneer",
        vessel_type="Container Ship",
        flag="Liberia",
        call_sign="ELAB4",
        mmsi="636012345",
        deadweight_tonnage=90000.0,
        gross_tonnage=55000.0,
        year_built=2021,
        status="active",
    )
    db_session.add_all([vessel_a, vessel_b])

    # Users in Org A
    user_admin = User(
        id=uuid.uuid4(),
        firebase_uid="uid_admin",
        email="admin@global-maritime.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_manager = User(
        id=uuid.uuid4(),
        firebase_uid="uid_manager",
        email="manager@global-maritime.com",
        role=UserRole.MANAGER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_operator = User(
        id=uuid.uuid4(),
        firebase_uid="uid_operator",
        email="operator@global-maritime.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_viewer = User(
        id=uuid.uuid4(),
        firebase_uid="uid_viewer",
        email="viewer@global-maritime.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    # User in Org B
    user_org_b = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org_b",
        email="admin@nordic-carrier.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_b.id,
        created_at=datetime.now(UTC),
    )
    # User with no organization
    user_no_org = User(
        id=uuid.uuid4(),
        firebase_uid="uid_no_org",
        email="no_org@independent.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=None,
        created_at=datetime.now(UTC),
    )
    db_session.add_all([user_admin, user_manager, user_operator, user_viewer, user_org_b, user_no_org])
    db_session.commit()

    return {
        "org_a": org_a,
        "org_b": org_b,
        "port_rtm": port_rtm,
        "vessel_a": vessel_a,
        "vessel_b": vessel_b,
        "admin": user_admin,
        "manager": user_manager,
        "operator": user_operator,
        "viewer": user_viewer,
        "org_b_user": user_org_b,
        "no_org_user": user_no_org,
    }


# ─── 1. Authentication & Tenant Authorization Tests ─────────────────────────


def test_unauthenticated_vessel_endpoints():
    """Unauthenticated requests across all vessel endpoints must be rejected with 401."""
    random_id = uuid.uuid4()
    app.dependency_overrides.clear()

    endpoints = [
        ("POST", "/api/v1/vessels", {"imo_number": "IMO9999999", "name": "V", "vessel_type": "Tanker"}),
        ("GET", "/api/v1/vessels", None),
        ("GET", f"/api/v1/vessels/{random_id}", None),
        ("PATCH", f"/api/v1/vessels/{random_id}", {"status": "in_drydock"}),
        ("DELETE", f"/api/v1/vessels/{random_id}", None),
    ]

    for method, path, payload in endpoints:
        if method == "POST":
            res = client.post(path, json=payload)
        elif method == "GET":
            res = client.get(path)
        elif method == "PATCH":
            res = client.patch(path, json=payload)
        elif method == "DELETE":
            res = client.delete(path)
        assert res.status_code == status.HTTP_401_UNAUTHORIZED, f"Failed 401 check for {method} {path}"


def test_user_without_org_rejected(db_session, seed_data):
    """User without an assigned organization must receive 403 Forbidden."""
    app.dependency_overrides[get_current_user] = lambda: seed_data["no_org_user"]
    app.dependency_overrides[get_db] = lambda: db_session

    try:
        res = client.get("/api/v1/vessels")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["detail"] == "Organization access required"
    finally:
        app.dependency_overrides.clear()


# ─── 2. RBAC Permission Tests ───────────────────────────────────────────────


def test_rbac_vessel_mutations(db_session, seed_data):
    """Verify RBAC: Viewer cannot mutate, Operator can create/update, only Manager/Admin can delete."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]

    # 1. Viewer trying to create vessel -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.post(
        "/api/v1/vessels",
        json={
            "imo_number": "IMO9333333",
            "name": "Unauthorized Vessel",
            "vessel_type": "Tanker",
        },
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 2. Operator successfully creates vessel -> 201
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.post(
        "/api/v1/vessels",
        json={
            "imo_number": "IMO9333333",
            "name": "Operator Vessel",
            "vessel_type": "General Cargo",
            "deadweight_tonnage": 25000.0,
        },
    )
    assert res.status_code == status.HTTP_201_CREATED
    created_id = res.json()["id"]

    # 3. Viewer trying to update vessel -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.patch(
        f"/api/v1/vessels/{created_id}",
        json={"status": "in_drydock"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 4. Operator trying to delete vessel -> 403 (Manager or above required)
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.delete(f"/api/v1/vessels/{created_id}")
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 5. Manager successfully deletes vessel -> 200
    app.dependency_overrides[get_current_user] = lambda: seed_data["manager"]
    res = client.delete(f"/api/v1/vessels/{created_id}")
    assert res.status_code == status.HTTP_200_OK
    assert res.json()["vessel_id"] == created_id

    app.dependency_overrides.clear()


# ─── 3. Validation Tests (422) ──────────────────────────────────────────────


def test_vessel_payload_validations(db_session, seed_data):
    """Ensure invalid fields produce 422 Unprocessable Entity."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # Negative deadweight tonnage on create -> 422
        res = client.post(
            "/api/v1/vessels",
            json={
                "imo_number": "IMO9444444",
                "name": "Negative DWT Vessel",
                "vessel_type": "Bulker",
                "deadweight_tonnage": -500.0,
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Empty vessel name -> 422
        res = client.post(
            "/api/v1/vessels",
            json={
                "imo_number": "IMO9444444",
                "name": "",
                "vessel_type": "Bulker",
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Negative tonnage on patch -> 422
        res = client.patch(
            f"/api/v1/vessels/{seed_data['vessel_a'].id}",
            json={"gross_tonnage": -100.0},
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    finally:
        app.dependency_overrides.clear()


# ─── 4. Uniqueness & Conflict Tests (409) ───────────────────────────────────


def test_imo_uniqueness_conflict(db_session, seed_data):
    """Ensure duplicate IMO numbers return 409 Conflict on create and update."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # 1. Attempt to create vessel with existing IMO number ("IMO9123456")
        res = client.post(
            "/api/v1/vessels",
            json={
                "imo_number": "IMO9123456",
                "name": "Duplicate IMO Vessel",
                "vessel_type": "Tanker",
            },
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert "already exists" in res.json()["detail"]

        # 2. Create another valid vessel
        res = client.post(
            "/api/v1/vessels",
            json={
                "imo_number": "IMO9555555",
                "name": "Unique Vessel Two",
                "vessel_type": "Container",
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        vessel_2_id = res.json()["id"]

        # 3. Patch vessel two with vessel one's IMO number -> 409 Conflict
        res = client.patch(
            f"/api/v1/vessels/{vessel_2_id}",
            json={"imo_number": "IMO9123456"},
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert "already exists" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ─── 5. CRUD, Listing, Filtering & Search ────────────────────────────────────


def test_vessel_crud_filtering_and_search(db_session, seed_data):
    """End-to-end vessel lifecycle with list filters and text search."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # 1. Create a detailed Vessel
        payload = {
            "imo_number": "IMO9777777",
            "name": "Ocean Discovery",
            "vessel_type": "LNG Carrier",
            "flag": "Marshall Islands",
            "call_sign": "V7AD3",
            "mmsi": "538001234",
            "deadweight_tonnage": 82000.5,
            "gross_tonnage": 98000.0,
            "year_built": 2022,
            "status": "active",
        }
        res = client.post("/api/v1/vessels", json=payload)
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        vessel_id = data["id"]
        assert data["imo_number"] == "IMO9777777"
        assert data["name"] == "Ocean Discovery"
        assert data["vessel_type"] == "LNG Carrier"
        assert data["flag"] == "Marshall Islands"
        assert data["deadweight_tonnage"] == 82000.5

        # 2. Get Vessel Details
        get_res = client.get(f"/api/v1/vessels/{vessel_id}")
        assert get_res.status_code == status.HTTP_200_OK
        assert get_res.json()["id"] == vessel_id

        # 3. Patch Vessel (Partial Update)
        patch_res = client.patch(
            f"/api/v1/vessels/{vessel_id}",
            json={
                "status": "in_drydock",
                "gross_tonnage": 98500.0,
            },
        )
        assert patch_res.status_code == status.HTTP_200_OK
        updated = patch_res.json()
        assert updated["status"] == "in_drydock"
        assert updated["gross_tonnage"] == 98500.0
        assert updated["name"] == "Ocean Discovery"  # preserved unchanged

        # 4. Filter List by status
        list_res = client.get("/api/v1/vessels?status=in_drydock")
        assert list_res.status_code == status.HTTP_200_OK
        assert list_res.json()["total"] == 1
        assert list_res.json()["items"][0]["id"] == vessel_id

        # 5. Filter List by vessel_type
        list_res = client.get("/api/v1/vessels?vessel_type=LNG")
        assert list_res.status_code == status.HTTP_200_OK
        assert list_res.json()["total"] == 1

        # 6. Text search by name
        search_res = client.get("/api/v1/vessels?search=Discovery")
        assert search_res.status_code == status.HTTP_200_OK
        assert search_res.json()["total"] == 1
        assert search_res.json()["items"][0]["name"] == "Ocean Discovery"

        # 7. Text search by call sign
        search_cs_res = client.get("/api/v1/vessels?search=V7AD3")
        assert search_cs_res.status_code == status.HTTP_200_OK
        assert search_cs_res.json()["total"] == 1

        # 8. Delete Vessel (Admin role)
        app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]
        del_res = client.delete(f"/api/v1/vessels/{vessel_id}")
        assert del_res.status_code == status.HTTP_200_OK
        assert del_res.json()["vessel_id"] == vessel_id

        # Confirm 404 after deletion
        assert client.get(f"/api/v1/vessels/{vessel_id}").status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


# ─── 6. Multi-Tenant Organization Isolation Tests ───────────────────────────


def test_cross_tenant_vessel_isolation(db_session, seed_data):
    """Verify Org B cannot view, edit, or delete Org A's vessels."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_b"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["org_b_user"]

    vessel_a_id = seed_data["vessel_a"].id

    try:
        # Org B listing vessels must NOT include Org A's vessel
        list_res = client.get("/api/v1/vessels")
        assert list_res.status_code == status.HTTP_200_OK
        vessel_ids = [item["id"] for item in list_res.json()["items"]]
        assert str(vessel_a_id) not in vessel_ids

        # Org B attempting to GET Org A's vessel -> 404
        get_res = client.get(f"/api/v1/vessels/{vessel_a_id}")
        assert get_res.status_code == status.HTTP_404_NOT_FOUND
        assert get_res.json()["detail"] == "Vessel not found"

        # Org B attempting to PATCH Org A's vessel -> 404
        patch_res = client.patch(
            f"/api/v1/vessels/{vessel_a_id}",
            json={"status": "decommissioned"},
        )
        assert patch_res.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to DELETE Org A's vessel -> 404
        del_res = client.delete(f"/api/v1/vessels/{vessel_a_id}")
        assert del_res.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


# ─── 7. Voyage Operational History Protection ───────────────────────────────


def test_vessel_deletion_blocked_by_existing_voyages(db_session, seed_data):
    """Ensure a vessel referenced by voyage records cannot be deleted (409 Conflict)."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]

    vessel = seed_data["vessel_a"]

    # 1. Link a Voyage to Vessel A
    voyage = Voyage(
        id=uuid.uuid4(),
        vessel_id=vessel.id,
        voyage_number="VOY-PROT-001",
        origin_port_id=seed_data["port_rtm"].id,
        status="in_transit",
    )
    db_session.add(voyage)
    db_session.commit()

    try:
        # 2. Attempt to delete Vessel A -> 409 Conflict
        del_res = client.delete(f"/api/v1/vessels/{vessel.id}")
        assert del_res.status_code == status.HTTP_409_CONFLICT
        assert "Cannot delete vessel with existing voyage records" in del_res.json()["detail"]

        # 3. Confirm vessel is still intact in database
        check_res = client.get(f"/api/v1/vessels/{vessel.id}")
        assert check_res.status_code == status.HTTP_200_OK
    finally:
        app.dependency_overrides.clear()
