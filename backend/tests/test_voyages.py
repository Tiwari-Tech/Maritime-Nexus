"""Comprehensive automated tests for Voyage and VoyageEvent Management API.

Tests cover:
- 401 Unauthenticated access across all endpoints
- 403 Forbidden for users without an organization
- RBAC role enforcement (Viewer, Operator, Manager, Admin)
- Data validation (422 Unprocessable Entity for inverted dates)
- Foreign key validations (404 Not Found for non-existent or other-org vessels/ports)
- Uniqueness collision handling (409 Conflict for duplicate voyage_number per vessel)
- Full CRUD lifecycle for voyages and events
- Filtering, sorting, and pagination for voyage listings
- Cascading deletion of events upon voyage removal
- Strict multi-tenant organization isolation
"""

import uuid
from datetime import datetime, timedelta, timezone

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
        Base.metadata.drop_all(engine)


@pytest.fixture
def seed_data(db_session):
    """Seed initial organizations, users with varying roles, vessels, and ports."""
    # Org A (Primary)
    org_a = Organization(
        id=uuid.uuid4(),
        name="Maritime Logistics Ltd",
        slug="maritime-logistics",
        is_active=True,
    )
    # Org B (Isolated Peer)
    org_b = Organization(
        id=uuid.uuid4(),
        name="Pacific Ocean Freight",
        slug="pacific-ocean-freight",
        is_active=True,
    )
    db_session.add_all([org_a, org_b])

    # Ports (Global reference data)
    port_rtm = Port(
        id=uuid.uuid4(),
        unlocode="NLRTM",
        name="Rotterdam",
        country="Netherlands",
        country_code="NL",
        latitude=51.9244,
        longitude=4.4777,
    )
    port_sin = Port(
        id=uuid.uuid4(),
        unlocode="SGSIN",
        name="Singapore",
        country="Singapore",
        country_code="SG",
        latitude=1.3521,
        longitude=103.8198,
    )
    db_session.add_all([port_rtm, port_sin])

    # Vessels
    vessel_a = Vessel(
        id=uuid.uuid4(),
        organization_id=org_a.id,
        name="Pacific Voyager",
        imo_number="IMO9123456",
        vessel_type="Bulk Carrier",
        deadweight_tonnage=75000.0,
    )
    vessel_b = Vessel(
        id=uuid.uuid4(),
        organization_id=org_b.id,
        name="Atlantic Pioneer",
        imo_number="IMO9654321",
        vessel_type="Container Ship",
        deadweight_tonnage=90000.0,
    )
    db_session.add_all([vessel_a, vessel_b])

    # Users in Org A with different RBAC privileges
    user_admin = User(
        id=uuid.uuid4(),
        firebase_uid="uid_admin",
        email="admin@logistics.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(timezone.utc),
    )
    user_manager = User(
        id=uuid.uuid4(),
        firebase_uid="uid_manager",
        email="manager@logistics.com",
        role=UserRole.MANAGER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(timezone.utc),
    )
    user_operator = User(
        id=uuid.uuid4(),
        firebase_uid="uid_operator",
        email="operator@logistics.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(timezone.utc),
    )
    user_viewer = User(
        id=uuid.uuid4(),
        firebase_uid="uid_viewer",
        email="viewer@logistics.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(timezone.utc),
    )
    # User in Org B
    user_org_b = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org_b",
        email="admin@pacific.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_b.id,
        created_at=datetime.now(timezone.utc),
    )
    # User with no organization
    user_no_org = User(
        id=uuid.uuid4(),
        firebase_uid="uid_no_org",
        email="unassigned@independent.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=None,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([user_admin, user_manager, user_operator, user_viewer, user_org_b, user_no_org])
    db_session.commit()

    return {
        "org_a": org_a,
        "org_b": org_b,
        "port_rtm": port_rtm,
        "port_sin": port_sin,
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


def test_unauthenticated_voyage_endpoints():
    """Unauthenticated requests across all voyage endpoints must be rejected with 401."""
    random_id = uuid.uuid4()
    app.dependency_overrides.clear()

    endpoints = [
        ("POST", "/api/v1/voyages", {"vessel_id": str(random_id), "voyage_number": "V1"}),
        ("GET", "/api/v1/voyages", None),
        ("GET", f"/api/v1/voyages/{random_id}", None),
        ("PATCH", f"/api/v1/voyages/{random_id}", {"status": "in_transit"}),
        ("DELETE", f"/api/v1/voyages/{random_id}", None),
        ("POST", f"/api/v1/voyages/{random_id}/events", {"event_type": "BERTHING", "timestamp": "2026-03-01T10:00:00Z"}),
        ("GET", f"/api/v1/voyages/{random_id}/events", None),
        ("GET", f"/api/v1/voyages/{random_id}/events/{random_id}", None),
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
        res = client.get("/api/v1/voyages")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["detail"] == "Organization access required"
    finally:
        app.dependency_overrides.clear()


# ─── 2. RBAC Permission Tests ───────────────────────────────────────────────


def test_rbac_voyage_mutations(db_session, seed_data):
    """Verify RBAC: Viewer cannot mutate, Operator can create/update, only Manager/Admin can delete."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]

    # 1. Viewer trying to create voyage -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.post(
        "/api/v1/voyages",
        json={
            "vessel_id": str(seed_data["vessel_a"].id),
            "voyage_number": "RBAC-001",
        },
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 2. Operator successfully creates voyage -> 201
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.post(
        "/api/v1/voyages",
        json={
            "vessel_id": str(seed_data["vessel_a"].id),
            "voyage_number": "RBAC-001",
            "status": "planned",
        },
    )
    assert res.status_code == status.HTTP_201_CREATED
    voyage_id = res.json()["id"]

    # 3. Viewer trying to update voyage -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.patch(
        f"/api/v1/voyages/{voyage_id}",
        json={"status": "in_transit"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 4. Viewer trying to add event -> 403
    res = client.post(
        f"/api/v1/voyages/{voyage_id}/events",
        json={"event_type": "DEPARTURE", "timestamp": "2026-03-01T12:00:00Z"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 5. Operator trying to delete voyage -> 403 (Manager or above required)
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.delete(f"/api/v1/voyages/{voyage_id}")
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 6. Manager successfully deletes voyage -> 200
    app.dependency_overrides[get_current_user] = lambda: seed_data["manager"]
    res = client.delete(f"/api/v1/voyages/{voyage_id}")
    assert res.status_code == status.HTTP_200_OK
    assert res.json()["voyage_id"] == voyage_id

    app.dependency_overrides.clear()


# ─── 3. Validation Tests (422) ──────────────────────────────────────────────


def test_date_validations(db_session, seed_data):
    """Ensure inverted dates produce 422 Unprocessable Entity."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    now = datetime.now(timezone.utc)
    earlier = now - timedelta(days=2)

    try:
        # Arrival earlier than departure on create
        res = client.post(
            "/api/v1/voyages",
            json={
                "vessel_id": str(seed_data["vessel_a"].id),
                "voyage_number": "DATE-ERR",
                "departure_date": now.isoformat(),
                "arrival_date": earlier.isoformat(),
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Create a valid voyage first
        res = client.post(
            "/api/v1/voyages",
            json={
                "vessel_id": str(seed_data["vessel_a"].id),
                "voyage_number": "DATE-VALID",
                "departure_date": earlier.isoformat(),
                "arrival_date": now.isoformat(),
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        voyage_id = res.json()["id"]

        # Inverted dates on patch
        res = client.patch(
            f"/api/v1/voyages/{voyage_id}",
            json={
                "departure_date": now.isoformat(),
                "arrival_date": earlier.isoformat(),
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Event end_timestamp earlier than timestamp
        res = client.post(
            f"/api/v1/voyages/{voyage_id}/events",
            json={
                "event_type": "BUNKERING",
                "timestamp": now.isoformat(),
                "end_timestamp": earlier.isoformat(),
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    finally:
        app.dependency_overrides.clear()


# ─── 4. Reference & Conflict Validations (404, 409) ──────────────────────────


def test_foreign_key_and_conflict_checks(db_session, seed_data):
    """Test 404 for invalid vessels/ports and 409 for duplicate voyage numbers."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    fake_id = uuid.uuid4()
    try:
        # 1. Non-existent vessel -> 404
        res = client.post(
            "/api/v1/voyages",
            json={"vessel_id": str(fake_id), "voyage_number": "V-404"},
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        assert res.json()["detail"] == "Vessel not found"

        # 2. Vessel belonging to Org B -> 404
        res = client.post(
            "/api/v1/voyages",
            json={"vessel_id": str(seed_data["vessel_b"].id), "voyage_number": "V-CROSS-VESSEL"},
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        assert res.json()["detail"] == "Vessel not found"

        # 3. Non-existent origin port -> 404
        res = client.post(
            "/api/v1/voyages",
            json={
                "vessel_id": str(seed_data["vessel_a"].id),
                "voyage_number": "V-BAD-PORT-1",
                "origin_port_id": str(fake_id),
            },
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        assert res.json()["detail"] == "Origin port not found"

        # 4. Non-existent destination port -> 404
        res = client.post(
            "/api/v1/voyages",
            json={
                "vessel_id": str(seed_data["vessel_a"].id),
                "voyage_number": "V-BAD-PORT-2",
                "destination_port_id": str(fake_id),
            },
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        assert res.json()["detail"] == "Destination port not found"

        # 5. Create voyage 1
        res = client.post(
            "/api/v1/voyages",
            json={
                "vessel_id": str(seed_data["vessel_a"].id),
                "voyage_number": "VOY-UNIQUE-01",
                "origin_port_id": str(seed_data["port_rtm"].id),
                "destination_port_id": str(seed_data["port_sin"].id),
            },
        )
        assert res.status_code == status.HTTP_201_CREATED

        # 6. Duplicate voyage_number on same vessel -> 409 Conflict
        res = client.post(
            "/api/v1/voyages",
            json={
                "vessel_id": str(seed_data["vessel_a"].id),
                "voyage_number": "VOY-UNIQUE-01",
            },
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert "already exists for this vessel" in res.json()["detail"]

        # 7. Create voyage 2
        res = client.post(
            "/api/v1/voyages",
            json={
                "vessel_id": str(seed_data["vessel_a"].id),
                "voyage_number": "VOY-UNIQUE-02",
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        voyage_2_id = res.json()["id"]

        # 8. Patch voyage 2 to voyage 1's number -> 409 Conflict
        res = client.patch(
            f"/api/v1/voyages/{voyage_2_id}",
            json={"voyage_number": "VOY-UNIQUE-01"},
        )
        assert res.status_code == status.HTTP_409_CONFLICT

        # 9. Patch voyage 2 with invalid port -> 404
        res = client.patch(
            f"/api/v1/voyages/{voyage_2_id}",
            json={"origin_port_id": str(fake_id)},
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

        # 10. Patch voyage 2 with vessel from another org -> 404
        res = client.patch(
            f"/api/v1/voyages/{voyage_2_id}",
            json={"vessel_id": str(seed_data["vessel_b"].id)},
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


# ─── 5. CRUD, Listing & Events Lifecycle Tests ──────────────────────────────


def test_voyage_crud_and_events_lifecycle(db_session, seed_data):
    """End-to-end voyage creation, update, event tracking, list filtering, and cascade deletion."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    departure = datetime.now(timezone.utc)
    arrival = departure + timedelta(days=14)

    try:
        # 1. Create Voyage
        payload = {
            "vessel_id": str(seed_data["vessel_a"].id),
            "voyage_number": "VOY-2026-001",
            "origin_port_id": str(seed_data["port_rtm"].id),
            "destination_port_id": str(seed_data["port_sin"].id),
            "departure_date": departure.isoformat(),
            "arrival_date": arrival.isoformat(),
            "status": "planned",
            "cargo_type": "Iron Ore",
            "cargo_quantity": 65000.5,
            "extra_metadata": {"charterer": "Global Commodities Ltd"},
        }
        create_res = client.post("/api/v1/voyages", json=payload)
        assert create_res.status_code == status.HTTP_201_CREATED
        voyage_data = create_res.json()
        voyage_id = voyage_data["id"]
        assert voyage_data["voyage_number"] == "VOY-2026-001"
        assert voyage_data["cargo_type"] == "Iron Ore"
        assert voyage_data["cargo_quantity"] == 65000.5
        assert voyage_data["extra_metadata"]["charterer"] == "Global Commodities Ltd"

        # 2. Add Milestone Events
        event1_time = departure + timedelta(hours=2)
        event1_res = client.post(
            f"/api/v1/voyages/{voyage_id}/events",
            json={
                "event_type": "DEPARTURE",
                "port_id": str(seed_data["port_rtm"].id),
                "timestamp": event1_time.isoformat(),
                "description": "Vessel unmoored and departed Rotterdam.",
                "is_delay": False,
            },
        )
        assert event1_res.status_code == status.HTTP_201_CREATED
        event1_id = event1_res.json()["id"]

        event2_time = departure + timedelta(days=5)
        event2_end = event2_time + timedelta(hours=8)
        event2_res = client.post(
            f"/api/v1/voyages/{voyage_id}/events",
            json={
                "event_type": "WEATHER_DELAY",
                "timestamp": event2_time.isoformat(),
                "end_timestamp": event2_end.isoformat(),
                "description": "Heavy sea state, speed reduced to 8 knots.",
                "is_delay": True,
                "delay_reason": "Adverse weather conditions",
            },
        )
        assert event2_res.status_code == status.HTTP_201_CREATED
        event2_id = event2_res.json()["id"]

        # 3. Retrieve Voyage Details (should include eagerly loaded events)
        get_res = client.get(f"/api/v1/voyages/{voyage_id}")
        assert get_res.status_code == status.HTTP_200_OK
        retrieved = get_res.json()
        assert retrieved["id"] == voyage_id
        assert len(retrieved["events"]) == 2
        assert retrieved["events"][0]["event_type"] == "DEPARTURE"
        assert retrieved["events"][1]["event_type"] == "WEATHER_DELAY"

        # 4. List Voyage Events Chronologically
        events_res = client.get(f"/api/v1/voyages/{voyage_id}/events")
        assert events_res.status_code == status.HTTP_200_OK
        events_list = events_res.json()
        assert events_list["total"] == 2
        assert events_list["items"][0]["id"] == event1_id
        assert events_list["items"][1]["id"] == event2_id

        # 5. Retrieve Single Event
        single_ev_res = client.get(f"/api/v1/voyages/{voyage_id}/events/{event1_id}")
        assert single_ev_res.status_code == status.HTTP_200_OK
        assert single_ev_res.json()["id"] == event1_id

        # Non-existent event returns 404
        bad_ev_res = client.get(f"/api/v1/voyages/{voyage_id}/events/{uuid.uuid4()}")
        assert bad_ev_res.status_code == status.HTTP_404_NOT_FOUND

        # 6. Partial Update (Patch) Voyage
        patch_res = client.patch(
            f"/api/v1/voyages/{voyage_id}",
            json={
                "status": "in_transit",
                "cargo_quantity": 64800.0,
            },
        )
        assert patch_res.status_code == status.HTTP_200_OK
        assert patch_res.json()["status"] == "in_transit"
        assert patch_res.json()["cargo_quantity"] == 64800.0

        # 7. List Voyages with Filtering and Pagination
        list_res = client.get(f"/api/v1/voyages?status=in_transit&vessel_id={seed_data['vessel_a'].id}")
        assert list_res.status_code == status.HTTP_200_OK
        data = list_res.json()
        assert data["total"] == 1
        assert data["page"] == 1
        assert data["items"][0]["voyage_number"] == "VOY-2026-001"

        # Filter by mismatching status returns 0
        empty_list_res = client.get("/api/v1/voyages?status=completed")
        assert empty_list_res.json()["total"] == 0
        assert len(empty_list_res.json()["items"]) == 0

        # 8. Delete Voyage with cascading events
        app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]
        del_res = client.delete(f"/api/v1/voyages/{voyage_id}")
        assert del_res.status_code == status.HTTP_200_OK
        assert del_res.json()["voyage_id"] == voyage_id

        # Confirm voyage is gone
        assert client.get(f"/api/v1/voyages/{voyage_id}").status_code == status.HTTP_404_NOT_FOUND

        # Confirm events query returns 404 because parent voyage is gone
        assert client.get(f"/api/v1/voyages/{voyage_id}/events").status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


# ─── 6. Multi-Tenant Organization Isolation Tests ───────────────────────────


def test_cross_tenant_organization_isolation(db_session, seed_data):
    """Verify Org B cannot view, edit, delete, or add events to Org A's voyages."""
    app.dependency_overrides[get_db] = lambda: db_session

    # 1. Org A creates a voyage
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]

    res = client.post(
        "/api/v1/voyages",
        json={
            "vessel_id": str(seed_data["vessel_a"].id),
            "voyage_number": "ORG-A-SECRET-01",
        },
    )
    assert res.status_code == status.HTTP_201_CREATED
    voyage_a_id = res.json()["id"]

    # Org A adds an event
    ev_res = client.post(
        f"/api/v1/voyages/{voyage_a_id}/events",
        json={
            "event_type": "LOADING",
            "timestamp": "2026-03-05T08:00:00Z",
        },
    )
    assert ev_res.status_code == status.HTTP_201_CREATED
    event_a_id = ev_res.json()["id"]

    # 2. Switch context to Org B
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_b"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["org_b_user"]

    try:
        # Org B listing voyages must NOT include Org A's voyage
        list_res = client.get("/api/v1/voyages")
        assert list_res.status_code == status.HTTP_200_OK
        voyage_ids = [item["id"] for item in list_res.json()["items"]]
        assert voyage_a_id not in voyage_ids

        # Org B attempting to GET Org A's voyage -> 404
        get_res = client.get(f"/api/v1/voyages/{voyage_a_id}")
        assert get_res.status_code == status.HTTP_404_NOT_FOUND
        assert get_res.json()["detail"] == "Voyage not found"

        # Org B attempting to PATCH Org A's voyage -> 404
        patch_res = client.patch(
            f"/api/v1/voyages/{voyage_a_id}",
            json={"status": "cancelled"},
        )
        assert patch_res.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to DELETE Org A's voyage -> 404
        del_res = client.delete(f"/api/v1/voyages/{voyage_a_id}")
        assert del_res.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to add event to Org A's voyage -> 404
        add_ev_res = client.post(
            f"/api/v1/voyages/{voyage_a_id}/events",
            json={"event_type": "SABOTAGE", "timestamp": "2026-03-05T09:00:00Z"},
        )
        assert add_ev_res.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to list events of Org A's voyage -> 404
        list_ev_res = client.get(f"/api/v1/voyages/{voyage_a_id}/events")
        assert list_ev_res.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to get specific event of Org A's voyage -> 404
        get_ev_res = client.get(f"/api/v1/voyages/{voyage_a_id}/events/{event_a_id}")
        assert get_ev_res.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()
