"""Comprehensive automated tests for Contract and ContractClause Management API.

Tests cover:
- 401 Unauthenticated access across all contract and clause endpoints
- 403 Forbidden for users without an organization
- RBAC role enforcement (Viewer, Operator, Manager, Admin)
- Data validation (422 for inverted commencement/expiration dates)
- Uniqueness collision handling (409 Conflict for duplicate contract_reference per org)
- Full CRUD lifecycle for contracts and clauses
- Document and Vessel integration (cross-org reference rejection yields 404)
- Deterministic ordering of clauses by sequence order_index
- Cascading deletion of clauses upon contract deletion without affecting source Documents
- Strict multi-tenant organization isolation
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
from backend.models.document import Document
from backend.models.document_chunk import DocumentChunk
from backend.models.organization import Organization, User
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


@pytest.fixture
def seed_data(db_session):
    """Seed initial organizations, users with varying roles, documents, vessels, and contracts."""
    # Org A (Primary)
    org_a = Organization(
        id=uuid.uuid4(),
        name="Maritime Chartering Ltd",
        slug="maritime-chartering",
        is_active=True,
    )
    # Org B (Isolated Peer)
    org_b = Organization(
        id=uuid.uuid4(),
        name="Global Bulk Carriers",
        slug="global-bulk",
        is_active=True,
    )
    db_session.add_all([org_a, org_b])

    # Document in Org A
    doc_a = Document(
        id=uuid.uuid4(),
        organization_id=org_a.id,
        title="Gencon_1994_Fixture.pdf",
        document_type="charter_party",
        file_type="pdf",
        gcs_uri="gs://bucket/gencon.pdf",
        status="processed",
    )
    # Document in Org B
    doc_b = Document(
        id=uuid.uuid4(),
        organization_id=org_b.id,
        title="NYPE_Time_Charter.pdf",
        document_type="charter_party",
        file_type="pdf",
        gcs_uri="gs://bucket/nype.pdf",
        status="processed",
    )
    db_session.add_all([doc_a, doc_b])

    # Document Chunk in Org A for clause linkage
    chunk_a = DocumentChunk(
        id=uuid.uuid4(),
        document_id=doc_a.id,
        chunk_index=0,
        content="Laytime shall be 72 running hours SHINC.",
        embedding=[0.1] * 1024,
    )
    db_session.add(chunk_a)

    # Vessel in Org A
    vessel_a = Vessel(
        id=uuid.uuid4(),
        organization_id=org_a.id,
        imo_number="IMO9111111",
        name="Ocean Giant",
        vessel_type="Bulk Carrier",
        status="active",
    )
    db_session.add(vessel_a)

    # Users in Org A
    user_admin = User(
        id=uuid.uuid4(),
        firebase_uid="uid_admin",
        email="admin@chartering.com",
        role=UserRole.ADMIN,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_manager = User(
        id=uuid.uuid4(),
        firebase_uid="uid_manager",
        email="manager@chartering.com",
        role=UserRole.MANAGER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_operator = User(
        id=uuid.uuid4(),
        firebase_uid="uid_operator",
        email="operator@chartering.com",
        role=UserRole.OPERATOR,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    user_viewer = User(
        id=uuid.uuid4(),
        firebase_uid="uid_viewer",
        email="viewer@chartering.com",
        role=UserRole.VIEWER,
        is_active=True,
        organization_id=org_a.id,
        created_at=datetime.now(UTC),
    )
    # User in Org B
    user_org_b = User(
        id=uuid.uuid4(),
        firebase_uid="uid_org_b",
        email="admin@global-bulk.com",
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
        "doc_a": doc_a,
        "doc_b": doc_b,
        "chunk_a": chunk_a,
        "vessel_a": vessel_a,
        "admin": user_admin,
        "manager": user_manager,
        "operator": user_operator,
        "viewer": user_viewer,
        "org_b_user": user_org_b,
        "no_org_user": user_no_org,
    }


# ─── 1. Authentication & Organization Membership Tests ──────────────────────


def test_unauthenticated_contract_and_clause_endpoints():
    """Unauthenticated requests across all contract and clause endpoints must be rejected with 401."""
    random_id = uuid.uuid4()
    app.dependency_overrides.clear()

    endpoints = [
        ("POST", "/api/v1/contracts", {"contract_reference": "CP-1", "contract_type": "Voyage Charter"}),
        ("GET", "/api/v1/contracts", None),
        ("GET", f"/api/v1/contracts/{random_id}", None),
        ("PATCH", f"/api/v1/contracts/{random_id}", {"status": "completed"}),
        ("DELETE", f"/api/v1/contracts/{random_id}", None),
        ("POST", f"/api/v1/contracts/{random_id}/clauses", {"clause_number": "1", "clause_type": "Laytime", "clause_text": "text"}),
        ("GET", f"/api/v1/contracts/{random_id}/clauses", None),
        ("GET", f"/api/v1/contracts/{random_id}/clauses/{random_id}", None),
        ("PATCH", f"/api/v1/contracts/{random_id}/clauses/{random_id}", {"clause_title": "New Title"}),
        ("DELETE", f"/api/v1/contracts/{random_id}/clauses/{random_id}", None),
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
        res = client.get("/api/v1/contracts")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["detail"] == "Organization access required"
    finally:
        app.dependency_overrides.clear()


# ─── 2. RBAC Permission Tests ───────────────────────────────────────────────


def test_rbac_contract_and_clause_mutations(db_session, seed_data):
    """Verify RBAC: Viewer cannot mutate, Operator can create/update, only Manager/Admin can delete."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]

    # 1. Viewer cannot create contract -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.post(
        "/api/v1/contracts",
        json={"contract_reference": "RBAC-CP-01", "contract_type": "Voyage Charter"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 2. Operator successfully creates contract -> 201
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.post(
        "/api/v1/contracts",
        json={"contract_reference": "RBAC-CP-01", "contract_type": "Voyage Charter"},
    )
    assert res.status_code == status.HTTP_201_CREATED
    contract_id = res.json()["id"]

    # 3. Viewer cannot create clause -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.post(
        f"/api/v1/contracts/{contract_id}/clauses",
        json={"clause_number": "1", "clause_type": "Demurrage", "clause_text": "USD 15,000/day"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 4. Operator creates clause -> 201
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.post(
        f"/api/v1/contracts/{contract_id}/clauses",
        json={"clause_number": "1", "clause_type": "Demurrage", "clause_text": "USD 15,000/day"},
    )
    assert res.status_code == status.HTTP_201_CREATED
    clause_id = res.json()["id"]

    # 5. Viewer cannot patch clause -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["viewer"]
    res = client.patch(
        f"/api/v1/contracts/{contract_id}/clauses/{clause_id}",
        json={"clause_title": "Demurrage Rate"},
    )
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 6. Operator cannot delete clause -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.delete(f"/api/v1/contracts/{contract_id}/clauses/{clause_id}")
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 7. Manager deletes clause -> 200
    app.dependency_overrides[get_current_user] = lambda: seed_data["manager"]
    res = client.delete(f"/api/v1/contracts/{contract_id}/clauses/{clause_id}")
    assert res.status_code == status.HTTP_200_OK

    # 8. Operator cannot delete contract -> 403
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]
    res = client.delete(f"/api/v1/contracts/{contract_id}")
    assert res.status_code == status.HTTP_403_FORBIDDEN

    # 9. Manager deletes contract -> 200
    app.dependency_overrides[get_current_user] = lambda: seed_data["manager"]
    res = client.delete(f"/api/v1/contracts/{contract_id}")
    assert res.status_code == status.HTTP_200_OK

    app.dependency_overrides.clear()


# ─── 3. Validation & Conflict Tests (422, 409) ──────────────────────────────


def test_contract_date_validation_and_uniqueness(db_session, seed_data):
    """Ensure inverted dates produce 422 and duplicate reference produces 409."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # Inverted dates on create (expiration < commencement) -> 422
        res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "DATE-ERR",
                "contract_type": "Time Charter",
                "commencement_date": "2026-06-01",
                "expiration_date": "2026-05-01",
            },
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

        # Create valid contract 1
        res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "CP-UNIQUE-01",
                "contract_type": "Voyage Charter",
                "commencement_date": "2026-05-01",
                "expiration_date": "2026-06-01",
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        contract_1_id = res.json()["id"]

        # Duplicate contract_reference in same org -> 409 Conflict
        res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "CP-UNIQUE-01",
                "contract_type": "Time Charter",
            },
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert "already exists in this organization" in res.json()["detail"]

        # Create contract 2
        res = client.post(
            "/api/v1/contracts",
            json={"contract_reference": "CP-UNIQUE-02", "contract_type": "Bareboat"},
        )
        assert res.status_code == status.HTTP_201_CREATED
        contract_2_id = res.json()["id"]

        # Patch contract 2 with contract 1's reference -> 409 Conflict
        res = client.patch(
            f"/api/v1/contracts/{contract_2_id}",
            json={"contract_reference": "CP-UNIQUE-01"},
        )
        assert res.status_code == status.HTTP_409_CONFLICT

        # Inverted dates on patch -> 422
        res = client.patch(
            f"/api/v1/contracts/{contract_1_id}",
            json={"expiration_date": "2026-04-01"},
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    finally:
        app.dependency_overrides.clear()


# ─── 4. Document & Vessel Relationship Integration ──────────────────────────


def test_contract_relationship_validation(db_session, seed_data):
    """Ensure referenced documents/vessels must exist and belong to caller's org."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    fake_id = uuid.uuid4()
    doc_b_id = seed_data["doc_b"].id  # belongs to Org B

    try:
        # Non-existent document -> 404
        res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "BAD-DOC",
                "contract_type": "Voyage Charter",
                "document_id": str(fake_id),
            },
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        assert "document not found" in res.json()["detail"].lower()

        # Document belonging to Org B -> 404
        res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "CROSS-DOC",
                "contract_type": "Voyage Charter",
                "document_id": str(doc_b_id),
            },
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

        # Valid Document in Org A -> 201
        res = client.post(
            "/api/v1/contracts",
            json={
                "contract_reference": "VALID-DOC-CP",
                "contract_type": "Voyage Charter",
                "document_id": str(seed_data["doc_a"].id),
                "vessel_id": str(seed_data["vessel_a"].id),
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        contract_id = res.json()["id"]

        # Valid document chunk on clause creation -> 201
        res = client.post(
            f"/api/v1/contracts/{contract_id}/clauses",
            json={
                "clause_number": "1",
                "clause_type": "Laytime",
                "clause_text": "72 running hours",
                "document_chunk_id": str(seed_data["chunk_a"].id),
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        assert res.json()["document_chunk_id"] == str(seed_data["chunk_a"].id)

        # Invalid document chunk ID on clause -> 404
        res = client.post(
            f"/api/v1/contracts/{contract_id}/clauses",
            json={
                "clause_number": "2",
                "clause_type": "Demurrage",
                "clause_text": "USD 10,000",
                "document_chunk_id": str(fake_id),
            },
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


# ─── 5. CRUD, Listing, Filtering & Deterministic Clause Ordering ────────────


def test_contract_crud_and_clause_lifecycle(db_session, seed_data):
    """End-to-end contract and clause management with deterministic order and safe deletion."""
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["operator"]

    try:
        # 1. Create detailed Contract
        payload = {
            "contract_reference": "GENCON-2026-001",
            "contract_type": "Voyage Charter",
            "charterer": "Atlantic Grain Exporters",
            "owner": "Maritime Chartering Ltd",
            "broker": "Braemar Seascope",
            "commencement_date": "2026-07-01",
            "expiration_date": "2026-07-15",
            "demurrage_rate_daily": 18500.0,
            "despatch_rate_daily": 9250.0,
            "laytime_allowed_hours": 96.0,
            "status": "active",
            "document_id": str(seed_data["doc_a"].id),
            "vessel_id": str(seed_data["vessel_a"].id),
        }
        res = client.post("/api/v1/contracts", json=payload)
        assert res.status_code == status.HTTP_201_CREATED
        contract_data = res.json()
        contract_id = contract_data["id"]
        assert contract_data["contract_reference"] == "GENCON-2026-001"
        assert contract_data["demurrage_rate_daily"] == 18500.0

        # 2. Add Clauses with specific order_index
        c2 = client.post(
            f"/api/v1/contracts/{contract_id}/clauses",
            json={
                "clause_number": "2",
                "clause_title": "Demurrage Terms",
                "clause_type": "Demurrage",
                "clause_text": "Demurrage at USD 18,500 per day or pro rata.",
                "order_index": 2,
            },
        )
        assert c2.status_code == status.HTTP_201_CREATED
        c2_id = c2.json()["id"]

        c1 = client.post(
            f"/api/v1/contracts/{contract_id}/clauses",
            json={
                "clause_number": "1",
                "clause_title": "Preamble & Parties",
                "clause_type": "Parties",
                "clause_text": "Agreement between Atlantic Grain and Maritime Chartering.",
                "order_index": 1,
            },
        )
        assert c1.status_code == status.HTTP_201_CREATED
        c1_id = c1.json()["id"]

        # 3. Retrieve Contract Details (should include eagerly loaded clauses)
        get_res = client.get(f"/api/v1/contracts/{contract_id}")
        assert get_res.status_code == status.HTTP_200_OK
        data = get_res.json()
        assert len(data["clauses"]) == 2
        # Clauses ordered by order_index: clause 1 then clause 2
        assert data["clauses"][0]["id"] == c1_id
        assert data["clauses"][1]["id"] == c2_id

        # 4. List Clauses endpoint
        clauses_res = client.get(f"/api/v1/contracts/{contract_id}/clauses")
        assert clauses_res.status_code == status.HTTP_200_OK
        items = clauses_res.json()["items"]
        assert items[0]["clause_number"] == "1"
        assert items[1]["clause_number"] == "2"

        # 5. Patch single clause
        patch_cl = client.patch(
            f"/api/v1/contracts/{contract_id}/clauses/{c2_id}",
            json={"clause_text": "Updated Demurrage: USD 20,000 per day."},
        )
        assert patch_cl.status_code == status.HTTP_200_OK
        assert "USD 20,000" in patch_cl.json()["clause_text"]

        # 6. Filter Contracts list
        list_res = client.get("/api/v1/contracts?contract_type=Voyage&search=Atlantic")
        assert list_res.status_code == status.HTTP_200_OK
        assert list_res.json()["total"] == 1
        assert list_res.json()["items"][0]["contract_reference"] == "GENCON-2026-001"

        # 7. Delete single clause
        app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]
        del_cl = client.delete(f"/api/v1/contracts/{contract_id}/clauses/{c1_id}")
        assert del_cl.status_code == status.HTTP_200_OK

        # Contract remains intact with 1 clause remaining
        rem_res = client.get(f"/api/v1/contracts/{contract_id}")
        assert len(rem_res.json()["clauses"]) == 1

        # 8. Delete Contract: cascades remaining clauses, source Document is untouched
        del_res = client.delete(f"/api/v1/contracts/{contract_id}")
        assert del_res.status_code == status.HTTP_200_OK

        # Contract is gone
        assert client.get(f"/api/v1/contracts/{contract_id}").status_code == status.HTTP_404_NOT_FOUND

        # Clauses of deleted contract return 404
        assert client.get(f"/api/v1/contracts/{contract_id}/clauses").status_code == status.HTTP_404_NOT_FOUND

        # Source Document in Org A remains intact in DB
        doc_check = db_session.query(Document).filter(Document.id == seed_data["doc_a"].id).first()
        assert doc_check is not None
    finally:
        app.dependency_overrides.clear()


# ─── 6. Multi-Tenant Organization Isolation Tests ───────────────────────────


def test_cross_tenant_contract_and_clause_isolation(db_session, seed_data):
    """Verify Org B cannot view, edit, delete, or add clauses to Org A's contracts."""
    app.dependency_overrides[get_db] = lambda: db_session

    # 1. Org A creates a contract with a clause
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_a"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["admin"]

    res = client.post(
        "/api/v1/contracts",
        json={"contract_reference": "ORG-A-CONFIDENTIAL", "contract_type": "Time Charter"},
    )
    assert res.status_code == status.HTTP_201_CREATED
    contract_a_id = res.json()["id"]

    cl_res = client.post(
        f"/api/v1/contracts/{contract_a_id}/clauses",
        json={"clause_number": "1", "clause_type": "Confidentiality", "clause_text": "Strict Non-Disclosure"},
    )
    assert cl_res.status_code == status.HTTP_201_CREATED
    clause_a_id = cl_res.json()["id"]

    # 2. Switch context to Org B
    app.dependency_overrides[get_current_org] = lambda: seed_data["org_b"]
    app.dependency_overrides[get_current_user] = lambda: seed_data["org_b_user"]

    try:
        # Org B listing contracts must NOT include Org A's contract
        list_res = client.get("/api/v1/contracts")
        assert list_res.status_code == status.HTTP_200_OK
        contract_ids = [item["id"] for item in list_res.json()["items"]]
        assert contract_a_id not in contract_ids

        # Org B attempting to GET Org A's contract -> 404
        get_res = client.get(f"/api/v1/contracts/{contract_a_id}")
        assert get_res.status_code == status.HTTP_404_NOT_FOUND
        assert get_res.json()["detail"] == "Contract not found"

        # Org B attempting to PATCH Org A's contract -> 404
        patch_res = client.patch(
            f"/api/v1/contracts/{contract_a_id}",
            json={"status": "cancelled"},
        )
        assert patch_res.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to DELETE Org A's contract -> 404
        del_res = client.delete(f"/api/v1/contracts/{contract_a_id}")
        assert del_res.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to add clause to Org A's contract -> 404
        add_cl = client.post(
            f"/api/v1/contracts/{contract_a_id}/clauses",
            json={"clause_number": "2", "clause_type": "Sabotage", "clause_text": "Breach"},
        )
        assert add_cl.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to list clauses of Org A's contract -> 404
        list_cl = client.get(f"/api/v1/contracts/{contract_a_id}/clauses")
        assert list_cl.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to get specific clause of Org A's contract -> 404
        get_cl = client.get(f"/api/v1/contracts/{contract_a_id}/clauses/{clause_a_id}")
        assert get_cl.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to patch specific clause of Org A's contract -> 404
        patch_cl = client.patch(
            f"/api/v1/contracts/{contract_a_id}/clauses/{clause_a_id}",
            json={"clause_title": "Tampered"},
        )
        assert patch_cl.status_code == status.HTTP_404_NOT_FOUND

        # Org B attempting to delete specific clause of Org A's contract -> 404
        del_cl = client.delete(f"/api/v1/contracts/{contract_a_id}/clauses/{clause_a_id}")
        assert del_cl.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()
