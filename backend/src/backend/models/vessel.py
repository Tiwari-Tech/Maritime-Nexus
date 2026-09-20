"""Vessel database model."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from backend.models.contract import Contract
    from backend.models.document import Document
    from backend.models.organization import Organization
    from backend.models.voyage import Voyage


class Vessel(Base, TimestampMixin):
    """Vessel entity representing maritime ships with IMO identity."""

    __tablename__ = "vessels"

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
    imo_number: Mapped[str] = mapped_column(
        String(10),
        unique=True,
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    vessel_type: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    flag: Mapped[str | None] = mapped_column(String(100), nullable=True)
    call_sign: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mmsi: Mapped[str | None] = mapped_column(String(20), nullable=True)
    deadweight_tonnage: Mapped[float | None] = mapped_column(Float, nullable=True)
    gross_tonnage: Mapped[float | None] = mapped_column(Float, nullable=True)
    year_built: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(50),
        default="active",
        index=True,
        nullable=False,
    )

    # Relationships
    organization: Mapped["Organization | None"] = relationship(
        "Organization",
        back_populates="vessels",
    )
    voyages: Mapped[list["Voyage"]] = relationship(
        "Voyage",
        back_populates="vessel",
        cascade="all, delete-orphan",
    )
    documents: Mapped[list["Document"]] = relationship(
        "Document",
        back_populates="vessel",
    )
    contracts: Mapped[list["Contract"]] = relationship(
        "Contract",
        back_populates="vessel",
    )
