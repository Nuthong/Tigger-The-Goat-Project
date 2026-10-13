"""Add-on service catalog schemas (breakfast, airport transfer, laundry ...)."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.services.addon_rules import Basis, service_basis


class ServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    service_id: int
    name: str
    price: Decimal
    description: str | None
    is_active: bool

    @computed_field  # type: ignore[prop-decorator]
    @property
    def basis(self) -> Basis:
        """What one unit is - it sets how many a stay may carry (BR-29)."""
        return service_basis(self.name, self.description)


class ServiceCatalogRow(ServiceOut):
    """A catalog row for the manager's screen - with what the service has sold
    on stays that were not cancelled (price locked per booking, BR-6)."""

    times_sold: int
    units_sold: int
    revenue: Decimal


class ServiceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool = True


class ServicePatch(BaseModel):
    """Change the list price, wording or availability. A new price applies to
    bookings made from now on - existing `booking_service` rows keep theirs."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
