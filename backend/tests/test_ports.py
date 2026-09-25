"""Comprehensive automated tests for Port Management API.

Tests cover:
- 401 Unauthenticated access across all port endpoints
- 403 Forbidden for users without an organization
- RBAC role enforcement (Viewer, Operator, Manager, Admin)
- Data validation (422 for latitude/longitude out of bounds, empty fields)
- Uniqueness collision handling (409 Conflict for duplicate UN/LOCODE)
- Full CRUD lifecycle for ports
- Filtering, text search, and pagination for port listings
- Operational safeguards (409 Conflict on delete if referenced by Voyage or VoyageEvent)
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
from backend.models.voyage_event import VoyageEvent
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
    """Seed initial organizations, users with varying roles, vessels, and ports."""
    # Organization
    org = Organization(
        id=uuid.uuid4(),
        name="Global Maritime Group",
        slug="global-maritime",
        is_active=True,
    )
    db_session.add(org)

    # Initial Ports (Global reference directory)
    port_rtm = Port(
        id=uuid.uuid4(),
        unlocode="NLRTM",
        name="Rotterdam",
        country="Netherlands",
        country_code="NL",
        latitude=51.9244,
        longitude=4.4777,
        timezone="Europe/Amsterdam",
    )
    port_sin = Port(
        id=uuid.uuid4(),
        unlocode="SGSIN",
        name="Singapore",
        country="Singapore",
        country_code="SG",
        latitude=1.3521,
        longitude=103.8198,
        timezone="Asia/Singapore",
    )
    db_session.add_all([port_rtm, port_sin])

    # Vessel for Voyage integration tests
    vessel = Vessel(
        id=uuid.uuid4(),
        organization_id=org.id,
        imo_number="IMO9123456",
        name="Pacific Voyager",
        vessel_type="Bulk Carrier",
        status="active",
    )
    db_session.add(vessel)

    # Users in Org with different roles
    user_admin = User(
        id=uuid.uuid4(),
        firebase_uid="uid_admin",
        email="admin@global-maritime.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org.id,
        created_at=datetime.now(UTC),
    )
    user_manager = User(
        id=uuid.uuid4(),
        firebase_uid="uid_manager",
        email="manager@global-maritime.com",
        role=UserRole.MANAGER,
        is_active=True,
        organization_id=org.id,
        created_at=datetime.now(UTC),
    )
    user_operator = User(
        id=uuid.uuid4(),
        firebase_uid="uid_operator",
        email="operator@global-maritime.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org.id,
        created_at=datetime.now(UTC),
    )
    user_viewer = User(
        id=uuid.uuid4(),
        firebase_uid="uid_viewer",
        email="viewer@global-maritime.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=org.id,
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
    db_session.add_all([user_admin, user_manager, user_operator, user_viewer, user_no_org])
    db_session.commit()

    return {
        "org": org,
        "port_rtm": port_rtm,
        "port_sin": port_sin,
        "vessel": vessel,
        "admin": user_admin,
        "manager": user_manager,
        "operator": user_operator,
        "viewer": user_viewer,
        "no_org_user": user_no_org,
    }


# ─── 1. Authentication & Organization Membership Tests ──────────────────────


def test_unauthenticated_port_endpoints():
    """Unauthenticated requests across all port endpoints must be rejected with 401."""
    random_id = uuid.uuid4()
    app.dependency_overrides.clear()

    endpoints = [
        ("POST", "/api/v1/ports", {"unlocode": "USNYC", "name": "New York", "country": "United States"}),
        ("GET", "/api/v1/ports", None),
        ("GET", f"/api/v1/ports/{random_id}", None),
        ("PATCH", f"/api/v1/ports/{random_id}", {"country_code": "US"}),
        ("DELETE", f"/api/v1/ports/{random_id}", None),
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
        res = client.get("/api/v1/ports")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["detail"] == "Organization access required"
    finally:
        app.dependency_overrides.clear()


# ─── 2. RBAC Permission Tests ───────────────────────────────────────────────


def test_rbac_port_mutations(db_session, seed_data):
    """Verify RBAC: Viewer cannot mutate, Operator can create/update, only Manager/Admin can delete."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org"]

    # 1. Viewer trying to create port -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.post(
        "/api/v1/ports",
        json={"unlocode": "JPTYO", "name": "Tokyo", "country": "Japan"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 2. Operator successfully creates port -> 201
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.post(
        "/api/v1/ports",
        json={"unlocode": "JPTYO", "name": "Tokyo", "country": "Japan", "country_code": "JP"},
    )
    assert res.status_code == status.HTTP_201_CREATED
    created_id = res.json()["id"]

    # 3. Viewer trying to update port -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.patch(
        f"/api/v1/ports/{created_id}",
        json={"timezone": "Asia/Tokyo"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 4. Operator trying to delete port -> 403 (Manager or above required)
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.delete(f"/api/v1/ports/{created_id}")
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 5. Manager successfully deletes port -> 200
    app.dependency_overrides[get_current_user] = lambda: seed_data["manager"]
    res = client.delete(f"/api/v1/ports/{created_id}")
    assert res.status_code == status.HTTP_200_OK
    assert res.json()["port_id"] == created_id

    app.dependency_overrides.clear()


# ─── 3. Validation Tests (422) ──────────────────────────────────────────────


def test_port_payload_validations(db_session, seed_data):
    """Ensure invalid coordinates and fields produce 422 Unprocessable Entity."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # Latitude out of bounds (> 90) -> 422
        res = client.post(
            "/api/v1/ports",
            json={
                "unlocode": "TEST1",
                "name": "Invalid Lat Port",
                "country": "Nowhere",
                "latitude": 95.5,
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Longitude out of bounds (< -180) -> 422
        res = client.post(
            "/api/v1/ports",
            json={
                "unlocode": "TEST2",
                "name": "Invalid Lon Port",
                "country": "Nowhere",
                "longitude": -185.0,
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Empty country -> 422
        res = client.post(
            "/api/v1/ports",
            json={
                "unlocode": "TEST3",
                "name": "Missing Country Port",
                "country": "",
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Latitude out of bounds on patch -> 422
        res = client.patch(
            f"/api/v1/ports/{seed_data['port_rtm'].id}",
            json={"latitude": -99.0},
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    finally:
        app.dependency_overrides.clear()


# ─── 4. Uniqueness & Conflict Tests (409) ───────────────────────────────────


def test_unlocode_uniqueness_conflict(db_session, seed_data):
    """Ensure duplicate UN/LOCODE returns 409 Conflict on create and update."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # 1. Attempt to create port with existing UN/LOCODE ("NLRTM")
        res = client.post(
            "/api/v1/ports",
            json={
                "unlocode": "NLRTM",
                "name": "Rotterdam Duplicate",
                "country": "Netherlands",
            },
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert "already exists" in res.json()["detail"]

        # 2. Create another valid port
        res = client.post(
            "/api/v1/ports",
            json={
                "unlocode": "BEANR",
                "name": "Antwerp",
                "country": "Belgium",
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        antwerp_id = res.json()["id"]

        # 3. Patch Antwerp with Rotterdam's UN/LOCODE -> 409 Conflict
        res = client.patch(
            f"/api/v1/ports/{antwerp_id}",
            json={"unlocode": "NLRTM"},
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert "already exists" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ─── 5. CRUD, Listing, Filtering & Search ────────────────────────────────────


def test_port_crud_filtering_and_search(db_session, seed_data):
    """End-to-end port lifecycle with directory filters and search."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # 1. Create a detailed Port
        payload = {
            "unlocode": "USNYC",
            "name": "New York Terminal",
            "country": "United States",
            "country_code": "US",
            "latitude": 40.7128,
            "longitude": -74.0060,
            "timezone": "America/New_York",
        }
        res = client.post("/api/v1/ports", json=payload)
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        port_id = data["id"]
        assert data["unlocode"] == "USNYC"
        assert data["name"] == "New York Terminal"
        assert data["country"] == "United States"
        assert data["country_code"] == "US"
        assert data["latitude"] == 40.7128
        assert data["longitude"] == -74.0060

        # 2. Get Port Details
        get_res = client.get(f"/api/v1/ports/{port_id}")
        assert get_res.status_code == status.HTTP_200_OK
        assert get_res.json()["id"] == port_id

        # 3. Patch Port
        patch_res = client.patch(
            f"/api/v1/ports/{port_id}",
            json={"name": "Port of New York & New Jersey"},
        )
        assert patch_res.status_code == status.HTTP_200_OK
        assert patch_res.json()["name"] == "Port of New York & New Jersey"
        assert patch_res.json()["unlocode"] == "USNYC"

        # 4. Filter by Country
        list_res = client.get("/api/v1/ports?country=Singapore")
        assert list_res.status_code == status.HTTP_200_OK
        assert list_res.json()["total"] == 1
        assert list_res.json()["items"][0]["unlocode"] == "SGSIN"

        # 5. Filter by country_code
        list_cc_res = client.get("/api/v1/ports?country_code=NL")
        assert list_cc_res.status_code == status.HTTP_200_OK
        assert list_cc_res.json()["total"] == 1
        assert list_cc_res.json()["items"][0]["unlocode"] == "NLRTM"

        # 6. Text search across ports
        search_res = client.get("/api/v1/ports?search=Jersey")
        assert search_res.status_code == status.HTTP_200_OK
        assert search_res.json()["total"] == 1
        assert search_res.json()["items"][0]["id"] == port_id

        # 7. Delete Port (Admin role)
        app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]
        del_res = client.delete(f"/api/v1/ports/{port_id}")
        assert del_res.status_code == status.HTTP_200_OK
        assert del_res.json()["port_id"] == port_id

        # Confirm 404 after deletion
        assert client.get(f"/api/v1/ports/{port_id}").status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


# ─── 6. Voyage Operational History Safeguards ───────────────────────────────


def test_port_deletion_safeguards_with_voyages_and_events(db_session, seed_data):
    """Ensure a port referenced by Voyage (origin/destination) or VoyageEvent cannot be deleted."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]

    port_rtm = seed_data["port_rtm"]
    port_sin = seed_data["port_sin"]
    vessel = seed_data["vessel"]

    # 1. Create a Voyage with Rotterdam as origin and Singapore as destination
    voyage = Voyage(
        id=uuid.uuid4(),
        vessel_id=vessel.id,
        voyage_number="VOY-PORT-TEST-01",
        origin_port_id=port_rtm.id,
        destination_port_id=port_sin.id,
        status="planned",
    )
    db_session.add(voyage)
    db_session.commit()

    try:
        # 2. Attempt to delete Rotterdam (referenced as origin) -> 409 Conflict
        del_rtm = client.delete(f"/api/v1/ports/{port_rtm.id}")
        assert del_rtm.status_code == status.HTTP_409_CONFLICT
        assert "Cannot delete port referenced by existing voyages" in del_rtm.json()["detail"]

        # 3. Attempt to delete Singapore (referenced as destination) -> 409 Conflict
        del_sin = client.delete(f"/api/v1/ports/{port_sin.id}")
        assert del_sin.status_code == status.HTTP_409_CONFLICT
        assert "Cannot delete port referenced by existing voyages" in del_sin.json()["detail"]

        # 4. Create an unreferenced third port, then add a VoyageEvent referencing it
        event_port = Port(
            id=uuid.uuid4(),
            unlocode="ESVLC",
            name="Valencia",
            country="Spain",
            country_code="ES",
        )
        db_session.add(event_port)
        db_session.commit()

        # Add event referencing Valencia
        event = VoyageEvent(
            id=uuid.uuid4(),
            voyage_id=voyage.id,
            port_id=event_port.id,
            event_type="BUNKERING",
            timestamp=datetime.now(UTC),
            description="Bunkering operations at Valencia",
        )
        db_session.add(event)
        db_session.commit()

        # 5. Attempt to delete Valencia -> 409 Conflict (referenced by VoyageEvent)
        del_vlc = client.delete(f"/api/v1/ports/{event_port.id}")
        assert del_vlc.status_code == status.HTTP_409_CONFLICT
        assert "Cannot delete port referenced by existing voyage events" in del_vlc.json()["detail"]

        # Confirm all ports remain intact
        assert client.get(f"/api/v1/ports/{port_rtm.id}").status_code == status.HTTP_200_OK
        assert client.get(f"/api/v1/ports/{port_sin.id}").status_code == status.HTTP_200_OK
        assert client.get(f"/api/v1/ports/{event_port.id}").status_code == status.HTTP_200_OK
    finally:
        app.dependency_overrides.clear()
