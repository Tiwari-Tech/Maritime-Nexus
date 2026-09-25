"""End-to-End Backend Integration Tests for Maritime Nexus.

Comprehensive integration test suite covering:
1. API Router Registry & OpenAPI Schema Integrity (no duplicate or conflicting routes)
2. Authentication -> Organization Onboarding -> Immediate Business Execution
3. Operational Workflow: Vessel -> Port -> Voyage -> VoyageEvent with Deletion Safeguards
4. Commercial Workflow: Document -> Chunk -> Contract -> ContractClause with Cascading Deletions
5. Cross-Tenant Multi-Organization Strict Isolation across all resources
6. Cross-Module RBAC Role Matrix (Viewer, Operator, Manager, Admin)
7. Semantic Vector RAG Search & Question-Answering Tenant Boundary Scoping
8. Error Handling Sanitization and Sensitive Information Protection (no SQL leaks or stack traces)
"""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

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
from backend.models.contract import Contract, ContractClause
from backend.models.document import Document
from backend.models.document_chunk import DocumentChunk
from backend.models.organization import Organization, User
from backend.models.port import Port
from backend.models.vessel import Vessel
from backend.models.voyage import Voyage
from backend.models.voyage_event import VoyageEvent
from backend.schemas.auth import UserRole
from backend.services.retrieval import SearchResultItem

# Ensure SQLite treats PostgreSQL JSONB as native JSON during in-memory testing
compiles(JSONB, "sqlite")(lambda type_, compiler, **kw: "JSON")

client = TestClient(app)


# ─── Database & Fixtures ────────────────────────────────────────────────────


@pytest.fixture
def db_session():
    """Create a clean in-memory SQLite database session for integration tests."""
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
def integration_data(db_session):
    """Seed comprehensive initial multi-tenant test data."""
    # ── Organizations ──
    org_a = Organization(
        id=uuid.uuid4(),
        name="Nordic Marine Logistics",
        slug="nordic-marine-logistics",
        is_active=True,
    )
    org_b = Organization(
        id=uuid.uuid4(),
        name="Mediterranean Freight Lines",
        slug="mediterranean-freight-lines",
        is_active=True,
    )
    db_session.add_all([org_a, org_b])

    # ── Global Ports ──
    port_sg = Port(
        id=uuid.uuid4(),
        unlocode="SGSIN",
        name="Singapore Port",
        country="Singapore",
        country_code="SG",
        latitude=1.29027,
        longitude=103.851959,
    )
    port_nl = Port(
        id=uuid.uuid4(),
        unlocode="NLRTM",
        name="Port of Rotterdam",
        country="Netherlands",
        country_code="NL",
        latitude=51.9244,
        longitude=4.4777,
    )
    port_ae = Port(
        id=uuid.uuid4(),
        unlocode="AEJEA",
        name="Jebel Ali",
        country="United Arab Emirates",
        country_code="AE",
        latitude=25.0113,
        longitude=55.0612,
    )
    db_session.add_all([port_sg, port_nl, port_ae])

    # ── Org A Fleet & Documents ──
    vessel_a = Vessel(
        id=uuid.uuid4(),
        organization_id=org_a.id,
        imo_number="IMO9123456",
        name="Nordic Trader",
        vessel_type="Bulk Carrier",
        flag="Panama",
        year_built=2018,
        deadweight_tonnage=75000.0,
        status="active",
    )
    doc_a = Document(
        id=uuid.uuid4(),
        organization_id=org_a.id,
        title="Gencon_1994_Nordic.pdf",
        document_type="CHARTER_PARTY",
        file_type="pdf",
        gcs_uri="gs://maritime-bucket/org_a/gencon.pdf",
        status="processed",
    )
    db_session.add_all([vessel_a, doc_a])
    db_session.flush()

    chunk_a = DocumentChunk(
        id=uuid.uuid4(),
        document_id=doc_a.id,
        chunk_index=0,
        content="Laytime for loading and discharging shall be 72 running hours SHINC.",
        embedding=[0.05] * 1024,
    )
    db_session.add(chunk_a)

    # ── Org B Fleet & Documents ──
    vessel_b = Vessel(
        id=uuid.uuid4(),
        organization_id=org_b.id,
        imo_number="IMO9876543",
        name="Med Voyager",
        vessel_type="Container Ship",
        flag="Liberia",
        year_built=2021,
        deadweight_tonnage=95000.0,
        status="active",
    )
    doc_b = Document(
        id=uuid.uuid4(),
        organization_id=org_b.id,
        title="NYPE_46_Med.pdf",
        document_type="CHARTER_PARTY",
        file_type="pdf",
        gcs_uri="gs://maritime-bucket/org_b/nype.pdf",
        status="processed",
    )
    db_session.add_all([vessel_b, doc_b])
    db_session.flush()

    chunk_b = DocumentChunk(
        id=uuid.uuid4(),
        document_id=doc_b.id,
        chunk_index=0,
        content="Hire rate shall be USD 28,500 per day or pro rata for any part of a day.",
        embedding=[-0.05] * 1024,
    )
    db_session.add(chunk_b)

    # ── Org A Users ──
    user_a_admin = User(
        id=uuid.uuid4(),
        firebase_uid="uid_a_admin",
        email="admin@nordicmarine.com",
        full_name="Nordic Admin",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_a_manager = User(
        id=uuid.uuid4(),
        firebase_uid="uid_a_manager",
        email="manager@nordicmarine.com",
        full_name="Nordic Manager",
        role=UserRole.MANAGER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_a_operator = User(
        id=uuid.uuid4(),
        firebase_uid="uid_a_operator",
        email="operator@nordicmarine.com",
        full_name="Nordic Operator",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_a_viewer = User(
        id=uuid.uuid4(),
        firebase_uid="uid_a_viewer",
        email="viewer@nordicmarine.com",
        full_name="Nordic Viewer",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )

    # ── Org B User ──
    user_b_admin = User(
        id=uuid.uuid4(),
        firebase_uid="uid_b_admin",
        email="admin@medlines.com",
        full_name="Med Admin",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_b.id,
        created_at=datetime.now(UTC),
    )

    # ── Unassigned User ──
    user_unassigned = User(
        id=uuid.uuid4(),
        firebase_uid="uid_unassigned",
        email="newuser@maritime-nexus.com",
        full_name="Fresh Signer",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=None,
        created_at=datetime.now(UTC),
    )

    db_session.add_all([
        user_a_admin,
        user_a_manager,
        user_a_operator,
        user_a_viewer,
        user_b_admin,
        user_unassigned,
    ])
    db_session.commit()

    return {
        "org_a": org_a,
        "org_b": org_b,
        "port_sg": port_sg,
        "port_nl": port_nl,
        "port_ae": port_ae,
        "vessel_a": vessel_a,
        "vessel_b": vessel_b,
        "doc_a": doc_a,
        "doc_b": doc_b,
        "chunk_a": chunk_a,
        "chunk_b": chunk_b,
        "user_a_admin": user_a_admin,
        "user_a_manager": user_a_manager,
        "user_a_operator": user_a_operator,
        "user_a_viewer": user_a_viewer,
        "user_b_admin": user_b_admin,
        "user_unassigned": user_unassigned,
    }


# ─── 1. API Router Registry & OpenAPI Schema Integrity ──────────────────────


def test_api_router_registry_integrity():
    """Verify that all expected routes are registered exactly once with correct methods."""
    schema = app.openapi()
    paths = schema.get("paths", {})

    expected_routes = [
        # Health & Readiness
        ("/health", ["get"]),
        ("/readiness", ["get"]),
        # Authentication
        ("/api/v1/auth/me", ["get"]),
        # Organization Onboarding
        ("/api/v1/organizations", ["post"]),
        # Documents
        ("/api/v1/documents", ["post", "get"]),
        ("/api/v1/documents/{document_id}", ["get", "delete"]),
        ("/api/v1/documents/{document_id}/download", ["get"]),
        ("/api/v1/documents/{document_id}/ingest", ["post"]),
        # Semantic RAG
        ("/api/v1/rag/search", ["post"]),
        ("/api/v1/rag/ask", ["post"]),
        # Voyages & Timeline Events
        ("/api/v1/voyages", ["post", "get"]),
        ("/api/v1/voyages/{voyage_id}", ["get", "patch", "delete"]),
        ("/api/v1/voyages/{voyage_id}/events", ["post", "get"]),
        ("/api/v1/voyages/{voyage_id}/events/{event_id}", ["get"]),
        # Vessels
        ("/api/v1/vessels", ["post", "get"]),
        ("/api/v1/vessels/{vessel_id}", ["get", "patch", "delete"]),
        # Ports
        ("/api/v1/ports", ["post", "get"]),
        ("/api/v1/ports/{port_id}", ["get", "patch", "delete"]),
        # Contracts & Clauses
        ("/api/v1/contracts", ["post", "get"]),
        ("/api/v1/contracts/{contract_id}", ["get", "patch", "delete"]),
        ("/api/v1/contracts/{contract_id}/clauses", ["post", "get"]),
        ("/api/v1/contracts/{contract_id}/clauses/{clause_id}", ["get", "patch", "delete"]),
    ]

    for path, methods in expected_routes:
        assert path in paths, f"Missing route {path} in OpenAPI registration"
        registered_methods = list(paths[path].keys())
        for method in methods:
            assert method in registered_methods, (
                f"Missing method {method.upper()} on route {path}"
            )

    # Verify unauthenticated access behavior
    app.dependency_overrides.clear()

    # Public routes succeed
    res_health = client.get("/health")
    assert res_health.status_code == status.HTTP_200_OK
    assert res_health.json()["status"] == "ok"

    # Readiness probe: healthy when DB is connected
    with patch("backend.api.routes.health.check_db_connection", return_value=True):
        res_ready = client.get("/readiness")
        assert res_ready.status_code == status.HTTP_200_OK
        assert res_ready.json() == {"status": "ready", "database": "connected"}

    # Readiness probe: 503 Service Unavailable when DB is disconnected
    with patch("backend.api.routes.health.check_db_connection", return_value=False):
        res_unready = client.get("/readiness")
        assert res_unready.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert res_unready.json() == {"status": "unhealthy", "database": "disconnected"}

    # Protected routes fail with 401
    protected_probes = [
        client.get("/api/v1/auth/me"),
        client.post("/api/v1/organizations", json={"name": "Org"}),
        client.get("/api/v1/vessels"),
        client.get("/api/v1/ports"),
        client.get("/api/v1/voyages"),
        client.get("/api/v1/contracts"),
        client.get("/api/v1/documents"),
        client.post("/api/v1/rag/search", json={"query": "test"}),
    ]
    for probe in protected_probes:
        assert probe.status_code == status.HTTP_401_UNAUTHORIZED


# ─── 2. Auth -> Organization Onboarding -> Business Access ──────────────────


def test_auth_organization_onboarding_to_business_execution(db_session, integration_data):
    """Full lifecycle: fresh user without org blocked from business APIs, creates org, becomes admin, creates records."""
    unassigned_user = integration_data["user_unassigned"]
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: unassigned_user

    try:
        # Step 1: User without org receives 403 Forbidden on business endpoints
        business_endpoints = [
            "/api/v1/vessels",
            "/api/v1/ports",
            "/api/v1/voyages",
            "/api/v1/contracts",
            "/api/v1/documents",
        ]
        for ep in business_endpoints:
            res = client.get(ep)
            assert res.status_code == status.HTTP_403_FORBIDDEN
            assert "Organization access required" in res.json()["detail"]

        # Step 2: User successfully onboards into a new organization
        org_payload = {"name": "Polar Shipping AS"}
        create_org_res = client.post("/api/v1/organizations", json=org_payload)
        assert create_org_res.status_code == status.HTTP_201_CREATED
        created_org_data = create_org_res.json()
        new_org_id = uuid.UUID(created_org_data["id"])
        assert created_org_data["name"] == "Polar Shipping AS"
        assert created_org_data["slug"] == "polar-shipping-as"

        # Step 3: Verify user identity promoted to ADMIN and bound to new org
        assert unassigned_user.organization_id == new_org_id
        assert unassigned_user.role == UserRole.ADMIN

        # Verify /api/v1/auth/me reflects the new state
        me_res = client.get("/api/v1/auth/me")
        assert me_res.status_code == status.HTTP_200_OK
        me_data = me_res.json()
        assert me_data["organization_id"] == str(new_org_id)
        assert me_data["role"] == "admin"

        # Step 4: User cannot create another organization (duplicate onboarding rejected)
        dup_org_res = client.post("/api/v1/organizations", json={"name": "Second Org"})
        assert dup_org_res.status_code == status.HTTP_409_CONFLICT
        assert dup_org_res.json()["detail"] == "User already belongs to an organization"

        # Step 5: User can now immediately create business resources
        created_org_instance = db_session.query(Organization).filter_by(id=new_org_id).first()
        app.dependency_overrides[get_current_org] = lambda: created_org_instance

        # Create vessel
        vessel_res = client.post(
            "/api/v1/vessels",
            json={
                "imo_number": "IMO9333333",
                "name": "Polar Pioneer",
                "vessel_type": "Ice-Class Bulk Carrier",
                "flag": "Norway",
                "year_built": 2022,
                "deadweight_tonnage": 68000.0,
            },
        )
        assert vessel_res.status_code == status.HTTP_201_CREATED
        vessel_id = vessel_res.json()["id"]

        # Create contract
        contract_res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "POLAR-CP-2026-01",
                "contract_type": "Voyage Charter",
                "vessel_id": vessel_id,
                "freight_rate": 32000.0,
                "demurrage_rate": 20000.0,
            },
        )
        assert contract_res.status_code == status.HTTP_201_CREATED
        assert contract_res.json()["contract_reference"] == "POLAR-CP-2026-01"

    finally:
        app.dependency_overrides.clear()


# ─── 3. Vessel -> Port -> Voyage -> VoyageEvent Operational Workflow ────────


def test_end_to_end_operational_lifecycle_and_deletion_safeguards(db_session, integration_data):
    """Verify operational workflow: Vessel + Ports -> Voyage -> Events -> Safeguards -> Cleanup."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: integration_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: integration_data["user_a_admin"]

    vessel_a = integration_data["vessel_a"]
    port_sg = integration_data["port_sg"]
    port_nl = integration_data["port_nl"]

    try:
        # Step 1: Create a Voyage connecting Vessel and Ports
        now = datetime.now(UTC)
        voyage_payload = {
            "voyage_number": "VOY-2026-NORDIC-01",
            "vessel_id": str(vessel_a.id),
            "origin_port_id": str(port_sg.id),
            "destination_port_id": str(port_nl.id),
            "cargo_type": "Iron Ore",
            "cargo_quantity": 65000.0,
            "charterer": "BHP Billiton",
            "freight_rate": 24.50,
            "demurrage_rate": 18000.0,
            "laytime_hours": 96.0,
            "planned_departure": (now + timedelta(days=1)).isoformat(),
            "planned_arrival": (now + timedelta(days=20)).isoformat(),
            "status": "PLANNED",
        }
        res_voyage = client.post("/api/v1/voyages", json=voyage_payload)
        assert res_voyage.status_code == status.HTTP_201_CREATED
        voyage_id = res_voyage.json()["id"]

        # Step 2: Record VoyageEvents along the journey
        t1 = now + timedelta(days=1, hours=2)
        event_1_payload = {
            "event_type": "DEPARTURE",
            "port_id": str(port_sg.id),
            "timestamp": t1.isoformat(),
            "description": "Vessel departed Singapore port following completed loading operations.",
            "is_delay": False,
        }
        res_e1 = client.post(f"/api/v1/voyages/{voyage_id}/events", json=event_1_payload)
        assert res_e1.status_code == status.HTTP_201_CREATED

        # Mid-voyage monsoon delay
        t2 = now + timedelta(days=8)
        event_2_payload = {
            "event_type": "WEATHER_DELAY",
            "timestamp": t2.isoformat(),
            "end_timestamp": (t2 + timedelta(hours=14)).isoformat(),
            "description": "Tropical storm diversion causing 14-hour passage delay.",
            "is_delay": True,
            "metadata": {"weather_force": 9, "diverted_miles": 65},
        }
        res_e2 = client.post(f"/api/v1/voyages/{voyage_id}/events", json=event_2_payload)
        assert res_e2.status_code == status.HTTP_201_CREATED

        # Arrival at Rotterdam
        t3 = now + timedelta(days=21)
        event_3_payload = {
            "event_type": "ARRIVAL",
            "port_id": str(port_nl.id),
            "timestamp": t3.isoformat(),
            "description": "Vessel arrived safely at Rotterdam Maasvlakte terminal.",
            "is_delay": False,
        }
        res_e3 = client.post(f"/api/v1/voyages/{voyage_id}/events", json=event_3_payload)
        assert res_e3.status_code == status.HTTP_201_CREATED

        # Step 3: Query Voyage Events timeline and verify chronological ordering
        timeline_res = client.get(f"/api/v1/voyages/{voyage_id}/events")
        assert timeline_res.status_code == status.HTTP_200_OK
        events_data = timeline_res.json()
        assert events_data["total"] == 3
        events_list = events_data["items"]
        assert len(events_list) == 3
        # Strict chronological ordering
        assert events_list[0]["event_type"] == "DEPARTURE"
        assert events_list[1]["event_type"] == "WEATHER_DELAY"
        assert events_list[2]["event_type"] == "ARRIVAL"

        # Verify delay event flag
        delay_events = [e for e in events_list if e["is_delay"]]
        assert len(delay_events) == 1
        assert delay_events[0]["event_type"] == "WEATHER_DELAY"

        # Step 4: Deletion Safeguards (Operational History Protection)
        # Attempting to delete origin port -> 409 Conflict
        del_origin_port = client.delete(f"/api/v1/ports/{port_sg.id}")
        assert del_origin_port.status_code == status.HTTP_409_CONFLICT
        assert "Cannot delete port referenced by existing voyages" in del_origin_port.json()["detail"]

        # Attempting to delete destination port -> 409 Conflict
        del_dest_port = client.delete(f"/api/v1/ports/{port_nl.id}")
        assert del_dest_port.status_code == status.HTTP_409_CONFLICT

        # Attempting to delete vessel -> 409 Conflict
        del_vessel = client.delete(f"/api/v1/vessels/{vessel_a.id}")
        assert del_vessel.status_code == status.HTTP_409_CONFLICT
        assert "Cannot delete vessel with existing voyage records" in del_vessel.json()["detail"]

        # Step 5: Complete Voyage and safely delete
        patch_voyage = client.patch(
            f"/api/v1/voyages/{voyage_id}",
            json={"status": "COMPLETED", "actual_arrival": t3.isoformat()},
        )
        assert patch_voyage.status_code == status.HTTP_200_OK

        del_voyage = client.delete(f"/api/v1/voyages/{voyage_id}")
        assert del_voyage.status_code == status.HTTP_200_OK

        # Verify child events are deleted with voyage cascade
        events_after = db_session.query(VoyageEvent).filter_by(voyage_id=uuid.UUID(voyage_id)).all()
        assert len(events_after) == 0

        # Verify Vessel and Ports remain intact
        assert db_session.query(Vessel).filter_by(id=vessel_a.id).first() is not None
        assert db_session.query(Port).filter_by(id=port_sg.id).first() is not None
        assert db_session.query(Port).filter_by(id=port_nl.id).first() is not None

    finally:
        app.dependency_overrides.clear()


# ─── 4. Document -> Chunk -> Contract -> Clause Commercial Workflow ────────


def test_end_to_end_contract_document_clause_workflow(db_session, integration_data):
    """Verify commercial workflow: Document Chunk -> Contract -> Clauses -> Cascade Delete."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: integration_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: integration_data["user_a_admin"]

    doc_a = integration_data["doc_a"]
    chunk_a = integration_data["chunk_a"]
    vessel_a = integration_data["vessel_a"]
    doc_b = integration_data["doc_b"]
    chunk_b = integration_data["chunk_b"]

    try:
        # Step 1: Cross-Tenant Protection on Contract creation
        # Referencing Org B's Document must return 404
        cross_doc_contract = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "CROSS-DOC-001",
                "contract_type": "Voyage Charter",
                "document_id": str(doc_b.id),
            },
        )
        assert cross_doc_contract.status_code == status.HTTP_404_NOT_FOUND
        assert "Referenced document not found" in cross_doc_contract.json()["detail"]

        # Step 2: Valid Contract referencing Org A Document & Vessel
        commence = datetime.now(UTC).date()
        expire = commence + timedelta(days=180)
        contract_res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "NORDIC-VC-2026-88",
                "contract_type": "Voyage Charter",
                "document_id": str(doc_a.id),
                "vessel_id": str(vessel_a.id),
                "commencement_date": commence.isoformat(),
                "expiration_date": expire.isoformat(),
                "freight_rate": 28.00,
                "demurrage_rate": 22000.0,
            },
        )
        assert contract_res.status_code == status.HTTP_201_CREATED
        contract_id = contract_res.json()["id"]

        # Step 3: Cross-Tenant Protection on ContractClause creation
        # Referencing Org B's DocumentChunk must return 404
        cross_chunk_clause = client.post(
            f"/api/v1/contracts/{contract_id}/clauses",
            json={
                "clause_number": "Cl-99",
                "clause_type": "Laytime",
                "clause_text": "Invalid cross-chunk clause",
                "document_chunk_id": str(chunk_b.id),
            },
        )
        assert cross_chunk_clause.status_code == status.HTTP_404_NOT_FOUND
        assert "Referenced document chunk not found" in cross_chunk_clause.json()["detail"]

        # Step 4: Attach valid structured clauses
        clauses_data = [
            {
                "clause_number": "1",
                "clause_title": "Laytime Definition",
                "clause_type": "Laytime",
                "clause_text": "72 running hours SHINC loading and discharging.",
                "order_index": 1,
                "document_chunk_id": str(chunk_a.id),
            },
            {
                "clause_number": "2",
                "clause_title": "Demurrage Rate",
                "clause_type": "Demurrage",
                "clause_text": "Demurrage shall be USD 22,000 per running day.",
                "order_index": 2,
            },
            {
                "clause_number": "3",
                "clause_title": "War Risk Clause",
                "clause_type": "War Risk",
                "clause_text": "Voyage shall not enter designated war risk zones without prior written agreement.",
                "order_index": 3,
            },
        ]
        for cl in clauses_data:
            c_res = client.post(f"/api/v1/contracts/{contract_id}/clauses", json=cl)
            assert c_res.status_code == status.HTTP_201_CREATED

        # Step 5: Query clauses and verify order_index sequencing
        clauses_res = client.get(f"/api/v1/contracts/{contract_id}/clauses")
        assert clauses_res.status_code == status.HTTP_200_OK
        clauses_data = clauses_res.json()
        assert clauses_data["total"] == 3
        retrieved_clauses = clauses_data["items"]
        assert len(retrieved_clauses) == 3
        assert [c["order_index"] for c in retrieved_clauses] == [1, 2, 3]
        assert retrieved_clauses[0]["document_chunk_id"] == str(chunk_a.id)

        # Step 6: Cascading Deletion
        del_contract = client.delete(f"/api/v1/contracts/{contract_id}")
        assert del_contract.status_code == status.HTTP_200_OK

        # Verify child clauses are cascade-deleted
        clauses_after = (
            db_session.query(ContractClause)
            .filter_by(contract_id=uuid.UUID(contract_id))
            .all()
        )
        assert len(clauses_after) == 0

        # Verify source Document, Chunk, and Vessel remain intact
        assert db_session.query(Document).filter_by(id=doc_a.id).first() is not None
        assert db_session.query(DocumentChunk).filter_by(id=chunk_a.id).first() is not None
        assert db_session.query(Vessel).filter_by(id=vessel_a.id).first() is not None

    finally:
        app.dependency_overrides.clear()


# ─── 5. Strict Multi-Tenant Organization Isolation ──────────────────────────


def test_cross_tenant_multi_organization_isolation(db_session, integration_data):
    """Verify that Organization B cannot view, edit, or delete any resource owned by Organization A."""
    app.dependency_overrides[get_db] = lambda: db_session

    org_a = integration_data["org_a"]
    org_b = integration_data["org_b"]
    vessel_a = integration_data["vessel_a"]
    vessel_b = integration_data["vessel_b"]
    doc_a = integration_data["doc_a"]
    doc_b = integration_data["doc_b"]
    port_sg = integration_data["port_sg"]
    port_nl = integration_data["port_nl"]

    # Org A creates a voyage and contract
    voyage_a = Voyage(
        id=uuid.uuid4(),
        vessel_id=vessel_a.id,
        origin_port_id=port_sg.id,
        destination_port_id=port_nl.id,
        voyage_number="VOY-ORG-A-SECURE",
        status="IN_PROGRESS",
    )
    contract_a = Contract(
        id=uuid.uuid4(),
        organization_id=org_a.id,
        vessel_id=vessel_a.id,
        contract_reference="CP-ORG-A-CONFIDENTIAL",
        contract_type="Time Charter",
        status="active",
    )
    db_session.add_all([voyage_a, contract_a])
    db_session.flush()

    clause_a = ContractClause(
        id=uuid.uuid4(),
        contract_id=contract_a.id,
        clause_number="A-1",
        clause_type="Confidential Terms",
        clause_text="Org A proprietary rate structure.",
        order_index=1,
    )
    event_a = VoyageEvent(
        id=uuid.uuid4(),
        voyage_id=voyage_a.id,
        event_type="BERTHING",
        timestamp=datetime.now(UTC),
        description="Org A vessel berthing event.",
    )
    db_session.add_all([clause_a, event_a])
    db_session.commit()

    # Now authenticate as Org B user
    app.dependency_overrides[get_current_org] = lambda: org_b
    app.dependency_overrides[get_current_user] = lambda: integration_data["user_b_admin"]

    try:
        # 1. Vessels isolation
        assert client.get(f"/api/v1/vessels/{vessel_a.id}").status_code == status.HTTP_404_NOT_FOUND
        assert (
            client.patch(f"/api/v1/vessels/{vessel_a.id}", json={"name": "Hacked"}).status_code
            == status.HTTP_404_NOT_FOUND
        )
        assert client.delete(f"/api/v1/vessels/{vessel_a.id}").status_code == status.HTTP_404_NOT_FOUND
        vessels_list = client.get("/api/v1/vessels").json()["items"]
        assert all(v["id"] != str(vessel_a.id) for v in vessels_list)
        assert any(v["id"] == str(vessel_b.id) for v in vessels_list)

        # 2. Voyages isolation
        assert client.get(f"/api/v1/voyages/{voyage_a.id}").status_code == status.HTTP_404_NOT_FOUND
        assert (
            client.patch(f"/api/v1/voyages/{voyage_a.id}", json={"status": "CANCELLED"}).status_code
            == status.HTTP_404_NOT_FOUND
        )
        assert client.delete(f"/api/v1/voyages/{voyage_a.id}").status_code == status.HTTP_404_NOT_FOUND
        assert (
            client.get(f"/api/v1/voyages/{voyage_a.id}/events").status_code
            == status.HTTP_404_NOT_FOUND
        )
        assert (
            client.post(
                f"/api/v1/voyages/{voyage_a.id}/events",
                json={
                    "event_type": "SPOOF",
                    "timestamp": datetime.now(UTC).isoformat(),
                    "description": "Spoofed event",
                },
            ).status_code
            == status.HTTP_404_NOT_FOUND
        )
        assert (
            client.get(f"/api/v1/voyages/{voyage_a.id}/events/{event_a.id}").status_code
            == status.HTTP_404_NOT_FOUND
        )

        # 3. Contracts isolation
        assert client.get(f"/api/v1/contracts/{contract_a.id}").status_code == status.HTTP_404_NOT_FOUND
        assert (
            client.patch(f"/api/v1/contracts/{contract_a.id}", json={"freight_rate": 1.0}).status_code
            == status.HTTP_404_NOT_FOUND
        )
        assert client.delete(f"/api/v1/contracts/{contract_a.id}").status_code == status.HTTP_404_NOT_FOUND
        assert (
            client.get(f"/api/v1/contracts/{contract_a.id}/clauses").status_code
            == status.HTTP_404_NOT_FOUND
        )
        assert (
            client.post(
                f"/api/v1/contracts/{contract_a.id}/clauses",
                json={
                    "clause_number": "X",
                    "clause_type": "Spoof",
                    "clause_text": "Illegal clause",
                },
            ).status_code
            == status.HTTP_404_NOT_FOUND
        )
        assert (
            client.get(f"/api/v1/contracts/{contract_a.id}/clauses/{clause_a.id}").status_code
            == status.HTTP_404_NOT_FOUND
        )

        # 4. Documents isolation
        assert client.get(f"/api/v1/documents/{doc_a.id}").status_code == status.HTTP_404_NOT_FOUND
        assert client.delete(f"/api/v1/documents/{doc_a.id}").status_code == status.HTTP_404_NOT_FOUND
        docs_list = client.get("/api/v1/documents").json()["items"]
        assert all(d["id"] != str(doc_a.id) for d in docs_list)
        assert any(d["id"] == str(doc_b.id) for d in docs_list)

        # Cross-tenant document upload foreign key validation
        cross_upload_res = client.post(
            "/api/v1/documents",
            data={"document_type": "OTHER", "vessel_id": str(vessel_a.id)},
            files={"file": ("cross_test.pdf", b"%PDF-1.4 sample content", "application/pdf")},
        )
        assert cross_upload_res.status_code == status.HTTP_404_NOT_FOUND
        assert "Associated vessel not found" in cross_upload_res.json()["detail"]

    finally:
        app.dependency_overrides.clear()


# ─── 6. Cross-Module RBAC Role Matrix ───────────────────────────────────────


def test_cross_module_rbac_matrix(db_session, integration_data):
    """Verify RBAC role matrix (Viewer, Operator, Manager, Admin) across business modules."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: integration_data["org_a"]

    viewer = integration_data["user_a_viewer"]
    operator = integration_data["user_a_operator"]
    manager = integration_data["user_a_manager"]
    vessel_a = integration_data["vessel_a"]
    port_sg = integration_data["port_sg"]
    port_nl = integration_data["port_nl"]
    doc_a = integration_data["doc_a"]

    # ── A. VIEWER ROLE (Read-only) ──
    app.dependency_overrides[get_current_user] = lambda: viewer
    try:
        # Reads are allowed
        assert client.get("/api/v1/vessels").status_code == status.HTTP_200_OK
        assert client.get("/api/v1/ports").status_code == status.HTTP_200_OK
        assert client.get("/api/v1/voyages").status_code == status.HTTP_200_OK
        assert client.get("/api/v1/contracts").status_code == status.HTTP_200_OK
        assert client.get("/api/v1/documents").status_code == status.HTTP_200_OK

        # Mutations are forbidden (403)
        assert (
            client.post("/api/v1/vessels", json={"imo_number": "IMO1111111", "name": "V"}).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.post("/api/v1/ports", json={"unlocode": "XXYYZ", "name": "P", "country": "C"}).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.post("/api/v1/voyages", json={"voyage_number": "VOY-X"}).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.post("/api/v1/contracts", json={"contract_reference": "CP-X", "contract_type": "T"}).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.delete(f"/api/v1/vessels/{vessel_a.id}").status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.post(
                "/api/v1/documents",
                data={"document_type": "CHARTER_PARTY"},
                files={"file": ("test.pdf", b"%PDF-1.4 mock content", "application/pdf")},
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.post(f"/api/v1/documents/{doc_a.id}/ingest").status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            client.delete(f"/api/v1/documents/{doc_a.id}").status_code
            == status.HTTP_403_FORBIDDEN
        )
    finally:
        pass

    # ── B. OPERATOR ROLE (Create/Update allowed, Delete forbidden) ──
    app.dependency_overrides[get_current_user] = lambda: operator
    try:
        # Operator can create voyage
        res_v = client.post(
            "/api/v1/voyages",
            json={
                "voyage_number": "VOY-OP-RBAC-01",
                "vessel_id": str(vessel_a.id),
                "origin_port_id": str(port_sg.id),
                "destination_port_id": str(port_nl.id),
                "status": "PLANNED",
            },
        )
        assert res_v.status_code == status.HTTP_201_CREATED
        op_voyage_id = res_v.json()["id"]

        # Operator can update voyage
        res_patch_v = client.patch(
            f"/api/v1/voyages/{op_voyage_id}",
            json={"status": "IN_PROGRESS"},
        )
        assert res_patch_v.status_code == status.HTTP_200_OK

        # Operator can create contract
        res_c = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "CP-OP-RBAC-01",
                "contract_type": "Voyage Charter",
                "vessel_id": str(vessel_a.id),
            },
        )
        assert res_c.status_code == status.HTTP_201_CREATED
        op_contract_id = res_c.json()["id"]

        # Operator CANNOT delete protected resources
        assert client.delete(f"/api/v1/vessels/{vessel_a.id}").status_code == status.HTTP_403_FORBIDDEN
        assert client.delete(f"/api/v1/contracts/{op_contract_id}").status_code == status.HTTP_403_FORBIDDEN
        assert client.delete(f"/api/v1/voyages/{op_voyage_id}").status_code == status.HTTP_403_FORBIDDEN
    finally:
        pass

    # ── C. MANAGER ROLE (Delete allowed) ──
    app.dependency_overrides[get_current_user] = lambda: manager
    try:
        # Manager can delete contract
        assert client.delete(f"/api/v1/contracts/{op_contract_id}").status_code == status.HTTP_200_OK
        # Manager can delete voyage
        assert client.delete(f"/api/v1/voyages/{op_voyage_id}").status_code == status.HTTP_200_OK
    finally:
        app.dependency_overrides.clear()


# ─── 7. Semantic Vector RAG Search & Tenant Boundary Scoping ────────────────


def test_rag_semantic_search_and_tenant_scoping(db_session, integration_data):
    """Verify that RAG semantic search strictly scopes retrievals to authenticated organization."""
    app.dependency_overrides[get_db] = lambda: db_session

    org_a = integration_data["org_a"]
    org_b = integration_data["org_b"]
    chunk_a = integration_data["chunk_a"]
    doc_a = integration_data["doc_a"]

    # Mock search service to verify tenant scoping argument
    search_item_a = SearchResultItem(
        chunk_id=chunk_a.id,
        document_id=doc_a.id,
        document_title=doc_a.title,
        chunk_index=0,
        page_number=1,
        content=chunk_a.content,
        similarity_score=0.912,
        metadata={"charter_type": "Gencon 1994"},
    )

    try:
        # Org A searches
        app.dependency_overrides[get_current_org] = lambda: org_a
        app.dependency_overrides[get_current_user] = lambda: integration_data["user_a_admin"]

        with patch("backend.api.routes.rag.search_document_chunks") as mock_search:
            mock_search.return_value = [search_item_a]

            res_search = client.post(
                "/api/v1/rag/search",
                json={"query": "laytime hours allowed", "top_k": 5},
            )
            assert res_search.status_code == status.HTTP_200_OK
            data = res_search.json()
            assert data["total_results"] == 1
            assert data["results"][0]["chunk_id"] == str(chunk_a.id)

            # Assert search was strictly invoked with Org A's ID
            mock_search.assert_called_once_with(
                query="laytime hours allowed",
                organization_id=org_a.id,
                db=db_session,
                document_id=None,
                top_k=5,
            )

        # Org B searches (must never see Org A's chunks)
        app.dependency_overrides[get_current_org] = lambda: org_b
        app.dependency_overrides[get_current_user] = lambda: integration_data["user_b_admin"]

        with patch("backend.api.routes.rag.search_document_chunks") as mock_search_b:
            mock_search_b.return_value = []

            res_b = client.post(
                "/api/v1/rag/search",
                json={"query": "laytime hours allowed"},
            )
            assert res_b.status_code == status.HTTP_200_OK
            assert res_b.json()["total_results"] == 0

            # Verified search requested Org B ID
            mock_search_b.assert_called_once_with(
                query="laytime hours allowed",
                organization_id=org_b.id,
                db=db_session,
                document_id=None,
                top_k=5,
            )

        # Question Answering grounded response
        with (
            patch("backend.api.routes.rag.search_document_chunks", return_value=[search_item_a]),
            patch(
                "backend.api.routes.rag.generate_grounded_answer",
                return_value="According to the charter party, laytime is 72 running hours SHINC.",
            ) as mock_llm,
        ):
            app.dependency_overrides[get_current_org] = lambda: org_a
            app.dependency_overrides[get_current_user] = lambda: integration_data["user_a_admin"]

            res_ask = client.post(
                "/api/v1/rag/ask",
                json={"query": "What are the laytime terms?"},
            )
            assert res_ask.status_code == status.HTTP_200_OK
            ask_data = res_ask.json()
            assert "72 running hours" in ask_data["answer"]
            assert len(ask_data["sources"]) == 1
            assert ask_data["sources"][0]["document_title"] == doc_a.title
            mock_llm.assert_called_once()

    finally:
        app.dependency_overrides.clear()


# ─── 8. Error Handling Sanitization & Database Integrity Checks ─────────────


def test_error_handling_sanitization_and_no_data_leakage(db_session, integration_data):
    """Verify error responses follow standard schema, appropriate status codes, and leak no internals."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: integration_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: integration_data["user_a_admin"]

    vessel_a = integration_data["vessel_a"]
    port_sg = integration_data["port_sg"]
    port_nl = integration_data["port_nl"]

    try:
        # 1. Validation Error: Inverted contract dates -> 422
        bad_contract = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "ERR-DATE-001",
                "contract_type": "Voyage Charter",
                "commencement_date": "2026-06-30",
                "expiration_date": "2026-01-01",  # inverted
            },
        )
        assert bad_contract.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        detail_msg = bad_contract.json()["detail"]
        assert "expiration_date cannot be earlier than commencement_date" in str(detail_msg)

        # 2. Validation Error: Inverted voyage dates -> 422
        bad_voyage = client.post(
            "/api/v1/voyages",
            json={
                "voyage_number": "ERR-VOY-001",
                "vessel_id": str(vessel_a.id),
                "origin_port_id": str(port_sg.id),
                "destination_port_id": str(port_nl.id),
                "departure_date": "2026-05-15T00:00:00Z",
                "arrival_date": "2026-05-10T00:00:00Z",  # inverted: arrival < departure
            },
        )
        assert bad_voyage.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "arrival_date cannot be earlier than departure_date" in str(bad_voyage.json()["detail"])

        # 3. Validation Error: Port coordinates out of bounds -> 422
        bad_port = client.post(
            "/api/v1/ports",
            json={
                "unlocode": "ZZZ99",
                "name": "Invalid Port",
                "country": "Nowhere",
                "latitude": 105.0,  # invalid latitude > 90
                "longitude": 40.0,
            },
        )
        assert bad_port.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # 4. Conflict Error: Duplicate contract reference in same org -> 409
        ok_contract = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "UNIQUE-REF-001",
                "contract_type": "Time Charter",
            },
        )
        assert ok_contract.status_code == status.HTTP_201_CREATED

        dup_contract = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "UNIQUE-REF-001",
                "contract_type": "Time Charter",
            },
        )
        assert dup_contract.status_code == status.HTTP_409_CONFLICT
        assert "already exists in this organization" in dup_contract.json()["detail"]

        # 5. Security & Sanitization Check: verify responses contain no raw SQL or DB secrets
        error_responses = [bad_contract, bad_voyage, bad_port, dup_contract]
        forbidden_substrings = [
            "password",
            "secret",
            "Traceback (most recent call last)",
            "postgresql://",
            "sqlite://",
            "sqlalchemy.exc",
        ]
        for err_res in error_responses:
            raw_text = err_res.text.lower()
            for token in forbidden_substrings:
                assert token.lower() not in raw_text, (
                    f"Sensitive internal token '{token}' found in error response: {raw_text}"
                )

    finally:
        app.dependency_overrides.clear()
