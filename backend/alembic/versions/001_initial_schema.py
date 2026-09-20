"""Initial database schema with pgvector support.

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-09-18 23:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import pgvector.sqlalchemy
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001_initial_schema"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 0. Ensure pgvector extension exists (safe and idempotent)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    # 1. Organizations table
    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_organizations_slug"),
    )
    op.create_index("ix_organizations_name", "organizations", ["name"], unique=False)
    op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)

    # 2. Users table
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("firebase_uid", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=50), server_default="operator", nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("firebase_uid", name="uq_users_firebase_uid"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_firebase_uid", "users", ["firebase_uid"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_organization_id", "users", ["organization_id"], unique=False)

    # 3. Ports table
    op.create_table(
        "ports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("unlocode", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("country", sa.String(length=100), nullable=False),
        sa.Column("country_code", sa.String(length=5), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("timezone", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("unlocode", name="uq_ports_unlocode"),
    )
    op.create_index("ix_ports_unlocode", "ports", ["unlocode"], unique=True)
    op.create_index("ix_ports_name", "ports", ["name"], unique=False)
    op.create_index("ix_ports_country", "ports", ["country"], unique=False)

    # 4. Vessels table
    op.create_table(
        "vessels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("imo_number", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("vessel_type", sa.String(length=100), nullable=False),
        sa.Column("flag", sa.String(length=100), nullable=True),
        sa.Column("call_sign", sa.String(length=50), nullable=True),
        sa.Column("mmsi", sa.String(length=20), nullable=True),
        sa.Column("deadweight_tonnage", sa.Float(), nullable=True),
        sa.Column("gross_tonnage", sa.Float(), nullable=True),
        sa.Column("year_built", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("imo_number", name="uq_vessels_imo_number"),
    )
    op.create_index("ix_vessels_imo_number", "vessels", ["imo_number"], unique=True)
    op.create_index("ix_vessels_name", "vessels", ["name"], unique=False)
    op.create_index("ix_vessels_vessel_type", "vessels", ["vessel_type"], unique=False)
    op.create_index("ix_vessels_status", "vessels", ["status"], unique=False)
    op.create_index("ix_vessels_organization_id", "vessels", ["organization_id"], unique=False)

    # 5. Voyages table
    op.create_table(
        "voyages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "vessel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vessels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("voyage_number", sa.String(length=100), nullable=False),
        sa.Column(
            "origin_port_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ports.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "destination_port_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ports.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("departure_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrival_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=50), server_default="planned", nullable=False),
        sa.Column("cargo_type", sa.String(length=100), nullable=True),
        sa.Column("cargo_quantity", sa.Float(), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("vessel_id", "voyage_number", name="uq_voyages_vessel_voyage_number"),
    )
    op.create_index("ix_voyages_vessel_id", "voyages", ["vessel_id"], unique=False)
    op.create_index("ix_voyages_voyage_number", "voyages", ["voyage_number"], unique=False)
    op.create_index("ix_voyages_origin_port_id", "voyages", ["origin_port_id"], unique=False)
    op.create_index("ix_voyages_destination_port_id", "voyages", ["destination_port_id"], unique=False)
    op.create_index("ix_voyages_status", "voyages", ["status"], unique=False)
    op.create_index("ix_voyages_departure_date", "voyages", ["departure_date"], unique=False)
    op.create_index("ix_voyages_arrival_date", "voyages", ["arrival_date"], unique=False)

    # 6. Voyage Events table
    op.create_table(
        "voyage_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "voyage_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("voyages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "port_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ports.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_delay", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("delay_reason", sa.String(length=255), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_voyage_events_voyage_id", "voyage_events", ["voyage_id"], unique=False)
    op.create_index("ix_voyage_events_port_id", "voyage_events", ["port_id"], unique=False)
    op.create_index("ix_voyage_events_event_type", "voyage_events", ["event_type"], unique=False)
    op.create_index("ix_voyage_events_timestamp", "voyage_events", ["timestamp"], unique=False)
    op.create_index("ix_voyage_events_is_delay", "voyage_events", ["is_delay"], unique=False)

    # 7. Documents table
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "uploader_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "vessel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vessels.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "voyage_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("voyages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("document_type", sa.String(length=100), nullable=False),
        sa.Column("file_type", sa.String(length=20), nullable=False),
        sa.Column("gcs_uri", sa.String(length=500), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="uploaded", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_documents_organization_id", "documents", ["organization_id"], unique=False)
    op.create_index("ix_documents_uploader_id", "documents", ["uploader_id"], unique=False)
    op.create_index("ix_documents_vessel_id", "documents", ["vessel_id"], unique=False)
    op.create_index("ix_documents_voyage_id", "documents", ["voyage_id"], unique=False)
    op.create_index("ix_documents_title", "documents", ["title"], unique=False)
    op.create_index("ix_documents_document_type", "documents", ["document_type"], unique=False)
    op.create_index("ix_documents_status", "documents", ["status"], unique=False)
    op.create_index("ix_documents_created_at", "documents", ["created_at"], unique=False)

    # 8. Document Versions table
    op.create_table(
        "document_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("gcs_uri", sa.String(length=500), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("file_hash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("document_id", "version_number", name="uq_document_versions_doc_version"),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"], unique=False)

    # 9. Document Chunks table (with pgvector embedding column)
    op.create_table(
        "document_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(1024), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_document_chunks_doc_chunk_index"),
    )
    op.create_index("ix_document_chunks_document_id", "document_chunks", ["document_id"], unique=False)
    op.create_index("ix_document_chunks_chunk_index", "document_chunks", ["chunk_index"], unique=False)
    op.create_index(
        "ix_document_chunks_embedding",
        "document_chunks",
        ["embedding"],
        unique=False,
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

    # 10. Contracts table
    op.create_table(
        "contracts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "vessel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vessels.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "voyage_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("voyages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("contract_reference", sa.String(length=100), nullable=False),
        sa.Column("contract_type", sa.String(length=100), nullable=False),
        sa.Column("charterer", sa.String(length=255), nullable=True),
        sa.Column("owner", sa.String(length=255), nullable=True),
        sa.Column("broker", sa.String(length=255), nullable=True),
        sa.Column("commencement_date", sa.Date(), nullable=True),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column("demurrage_rate_daily", sa.Float(), nullable=True),
        sa.Column("despatch_rate_daily", sa.Float(), nullable=True),
        sa.Column("laytime_allowed_hours", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_contracts_organization_id", "contracts", ["organization_id"], unique=False)
    op.create_index("ix_contracts_document_id", "contracts", ["document_id"], unique=False)
    op.create_index("ix_contracts_vessel_id", "contracts", ["vessel_id"], unique=False)
    op.create_index("ix_contracts_voyage_id", "contracts", ["voyage_id"], unique=False)
    op.create_index("ix_contracts_contract_reference", "contracts", ["contract_reference"], unique=False)
    op.create_index("ix_contracts_contract_type", "contracts", ["contract_type"], unique=False)
    op.create_index("ix_contracts_status", "contracts", ["status"], unique=False)
    op.create_index("ix_contracts_commencement_date", "contracts", ["commencement_date"], unique=False)
    op.create_index("ix_contracts_expiration_date", "contracts", ["expiration_date"], unique=False)

    # 11. Contract Clauses table
    op.create_table(
        "contract_clauses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "contract_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contracts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_chunk_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("document_chunks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("clause_number", sa.String(length=50), nullable=False),
        sa.Column("clause_title", sa.String(length=255), nullable=True),
        sa.Column("clause_type", sa.String(length=100), nullable=False),
        sa.Column("clause_text", sa.Text(), nullable=False),
        sa.Column("order_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_contract_clauses_contract_id", "contract_clauses", ["contract_id"], unique=False)
    op.create_index("ix_contract_clauses_document_chunk_id", "contract_clauses", ["document_chunk_id"], unique=False)
    op.create_index("ix_contract_clauses_clause_type", "contract_clauses", ["clause_type"], unique=False)
    op.create_index("ix_contract_clauses_order_index", "contract_clauses", ["order_index"], unique=False)


def downgrade() -> None:
    op.drop_table("contract_clauses")
    op.drop_table("contracts")
    op.drop_table("document_chunks")
    op.drop_table("document_versions")
    op.drop_table("documents")
    op.drop_table("voyage_events")
    op.drop_table("voyages")
    op.drop_table("vessels")
    op.drop_table("ports")
    op.drop_table("users")
    op.drop_table("organizations")
