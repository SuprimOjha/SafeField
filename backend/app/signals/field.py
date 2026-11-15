from datetime import date, datetime, timezone
from pathlib import Path

from app.schemas import PowerSummaryResponse
from app.services.rainfall import RainfallObservation
from app.signals.config import SignalGates, get_gates
from app.signals.heat import build_heat_air_signal
from app.signals.lst import LstProvider
from app.signals.models import SignalBundle, SignalValue
from app.signals.smap import SmapProvider
from app.signals.vegetation import VegProvider


def build_rain_signal(observation: RainfallObservation) -> SignalValue:
    """Convert a rainfall observation into a signal with a full provenance envelope."""
    if observation.status != "AVAILABLE" or observation.amount_mm is None or observation.provenance is None:
        return SignalValue(
            name="rain",
            status="unavailable",
            unavailable_reason=observation.unavailable_reason
            or "No local rainfall observation is available for the requested window.",
        )

    source = observation.provenance
    is_nasa = "imerg" in source.source_name.lower() or "nasa" in source.source_name.lower()
    if source.kind == "observation" and is_nasa:
        caveat = (
            "Satellite rainfall estimate for the area around the field, not a rain gauge in "
            "the plot. Pixel resolution limits how precisely a small field is represented."
        )
    else:
        caveat = (
            "Model or reanalysis rainfall estimate for the area around the field, not a rain "
            "gauge in the plot. It may differ from what fell on the field."
        )

    return SignalValue(
        name="rain",
        status="available",
        value=round(float(observation.amount_mm), 2),
        unit=f"mm over {observation.window_hours} h",
        provenance={
            "source_name": source.source_name,
            "product": source.dataset,
            "version": source.version,
            "kind": source.kind,
            "is_nasa": is_nasa,
            "valid_date": source.observed_end_utc.date(),
            "observed_start": source.observed_start_utc,
            "observed_end": source.observed_end_utc,
            "fetched_at": source.fetched_at_utc,
            "spatial_resolution": source.spatial_resolution or "not reported by provider",
            "latency_note": source.latency_note,
            "granule_ids": source.granule_ids,
            "coverage_fraction": source.coverage_fraction,
            "source_key": "imerg" if is_nasa else "open_meteo_past",
            "caveat": caveat,
        },
    )


def build_signal_bundle(
    latitude: float,
    longitude: float,
    *,
    summary: PowerSummaryResponse | None = None,
    observation: RainfallObservation | None = None,
    today: date | None = None,
    gates: SignalGates | None = None,
    root: Path | None = None,
) -> SignalBundle:
    """Assemble every field signal without hiding missing sources."""
    gates = gates or get_gates()
    current = today or date.today()
    signals: dict = {}

    signals["rain"] = (
        build_rain_signal(observation)
        if observation is not None
        else SignalValue(
            name="rain",
            status="unavailable",
            unavailable_reason="No local rainfall observation was supplied for this field.",
        )
    )

    smap = SmapProvider(root=root, gates=gates)
    signals.update(smap.get_signals(latitude, longitude, current))

    signals["heat_surface"] = LstProvider(root=root, gates=gates).get_signal(
        latitude, longitude, current
    )
    signals.update(VegProvider(root=root, gates=gates).get_signals(latitude, longitude, current))

    signals["heat_air"] = (
        build_heat_air_signal(summary, gates=gates)
        if summary is not None
        else SignalValue(
            name="heat_air",
            status="unavailable",
            unavailable_reason="NASA POWER air temperature was not supplied for this field.",
        )
    )

    warnings = [
        f"{name}: {signal.status} — {signal.unavailable_reason}"
        for name, signal in signals.items()
        if signal.status in {"unavailable", "not_installed"}
    ]
    return SignalBundle(
        latitude=latitude,
        longitude=longitude,
        generated_at=datetime.now(timezone.utc),
        signals=signals,
        warnings=warnings,
    )
