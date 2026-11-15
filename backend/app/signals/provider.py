from datetime import date
from typing import Protocol, runtime_checkable

from app.signals.models import SignalValue


@runtime_checkable
class SignalProvider(Protocol):
    """Read-only signal provider backed by persisted, provenance-carrying data."""

    name: str

    def get_signal(
        self,
        latitude: float,
        longitude: float,
        today: date | None = None,
    ) -> SignalValue:
        """Return one signal for the nearest source cell, or an unavailable state."""
        ...
