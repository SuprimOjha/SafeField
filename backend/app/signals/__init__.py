"""Signal framework shared by satellite, weather and farmer inputs.

Every signal carries a provenance envelope. Missing data stays missing: a
provider must return an explicit unavailable state with a reason rather than a
zero or a guessed value.
"""

from app.signals.models import (
    DataStatusFile,
    SignalBundle,
    SignalKind,
    SignalName,
    SignalProvenance,
    SignalStatus,
    SignalValue,
    SourceStatus,
    VsNormal,
)

__all__ = [
    "DataStatusFile",
    "SignalBundle",
    "SignalKind",
    "SignalName",
    "SignalProvenance",
    "SignalStatus",
    "SignalValue",
    "SourceStatus",
    "VsNormal",
]
