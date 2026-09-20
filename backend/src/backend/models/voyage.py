"""Voyage database model."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from backend.models.contract import Contract
    from backend.models.document import Document
    from backend.models.port import Port
    from backend.models.vessel import Vessel
    from backend.models.voyage_event import VoyageEvent


class Voyage(Base, TimestampMixin):
    """Voyage entity representing a vessel's voyage journey."""

    __tablename__ = "voyages"
    __table_args__ = (
        UniqueConstraint(
            "vessel_id",
            "voyage_number",
            name="uq_voyages_vessel_voyage_number",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    vessel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vessels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    voyage_number: Mapped[str] = mapped_column(
        String(100),
        index=True,
        nullable=False,
    )
    origin_port_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ports.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    destination_port_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ports.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    departure_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        index=True,
        nullable=True,
    )
    arrival_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        index=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(50),
        default="planned",
        index=True,
        nullable=False,
    )
    cargo_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cargo_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    extra_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Relationships
    vessel: Mapped["Vessel"] = relationship(
        "Vessel",
        back_populates="voyages",
    )
    origin_port: Mapped["Port | None"] = relationship(
        "Port",
        foreign_keys=[origin_port_id],
        back_populates="origin_voyages",
    )
    destination_port: Mapped["Port | None"] = relationship(
        "Port",
        foreign_keys=[destination_port_id],
        back_populates="destination_voyages",
    )
    events: Mapped[list["VoyageEvent"]] = relationship(
        "VoyageEvent",
        back_populates="voyage",
        cascade="all, delete-orphan",
        order_by="VoyageEvent.timestamp",
    )
    documents: Mapped[list["Document"]] = relationship(
        "Document",
        back_populates="voyage",
    )
    contracts: Mapped[list["Contract"]] = relationship(
        "Contract",
        back_populates="voyage",
    )
