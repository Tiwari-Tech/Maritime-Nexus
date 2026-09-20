"""Port database model."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Float, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from backend.models.voyage import Voyage
    from backend.models.voyage_event import VoyageEvent


class Port(Base, TimestampMixin):
    """Port entity representing maritime ports with UN/LOCODE standard."""

    __tablename__ = "ports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    unlocode: Mapped[str] = mapped_column(
        String(10),
        unique=True,
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    country: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(5), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Relationships
    origin_voyages: Mapped[list["Voyage"]] = relationship(
        "Voyage",
        foreign_keys="Voyage.origin_port_id",
        back_populates="origin_port",
    )
    destination_voyages: Mapped[list["Voyage"]] = relationship(
        "Voyage",
        foreign_keys="Voyage.destination_port_id",
        back_populates="destination_port",
    )
    voyage_events: Mapped[list["VoyageEvent"]] = relationship(
        "VoyageEvent",
        back_populates="port",
    )
