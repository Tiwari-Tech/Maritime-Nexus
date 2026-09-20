"""Contract and ContractClause database models."""

import uuid
from datetime import date
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from backend.models.document import Document
    from backend.models.document_chunk import DocumentChunk
    from backend.models.organization import Organization
    from backend.models.vessel import Vessel
    from backend.models.voyage import Voyage


class Contract(Base, TimestampMixin):
    """Contract entity representing maritime charter parties and contracts."""

    __tablename__ = "contracts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    vessel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vessels.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    voyage_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("voyages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    contract_reference: Mapped[str] = mapped_column(
        String(100),
        index=True,
        nullable=False,
    )
    contract_type: Mapped[str] = mapped_column(
        String(100),
        index=True,
        nullable=False,
    )
    charterer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    broker: Mapped[str | None] = mapped_column(String(255), nullable=True)
    commencement_date: Mapped[date | None] = mapped_column(
        Date,
        index=True,
        nullable=True,
    )
    expiration_date: Mapped[date | None] = mapped_column(
        Date,
        index=True,
        nullable=True,
    )
    demurrage_rate_daily: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    despatch_rate_daily: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    laytime_allowed_hours: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(50),
        default="active",
        index=True,
        nullable=False,
    )
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization | None"] = relationship(
        "Organization",
        back_populates="contracts",
    )
    document: Mapped["Document | None"] = relationship(
        "Document",
        back_populates="contracts",
    )
    vessel: Mapped["Vessel | None"] = relationship(
        "Vessel",
        back_populates="contracts",
    )
    voyage: Mapped["Voyage | None"] = relationship(
        "Voyage",
        back_populates="contracts",
    )
    clauses: Mapped[list["ContractClause"]] = relationship(
        "ContractClause",
        back_populates="contract",
        cascade="all, delete-orphan",
        order_by="ContractClause.order_index",
    )


class ContractClause(Base, TimestampMixin):
    """ContractClause entity representing individual contract clauses."""

    __tablename__ = "contract_clauses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    contract_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("document_chunks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    clause_number: Mapped[str] = mapped_column(String(50), nullable=False)
    clause_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    clause_type: Mapped[str] = mapped_column(
        String(100),
        index=True,
        nullable=False,
    )
    clause_text: Mapped[str] = mapped_column(Text, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Relationships
    contract: Mapped["Contract"] = relationship(
        "Contract",
        back_populates="clauses",
    )
    document_chunk: Mapped["DocumentChunk | None"] = relationship(
        "DocumentChunk",
        back_populates="clauses",
    )
