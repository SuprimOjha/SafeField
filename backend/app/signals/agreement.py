from statistics import fmean
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.rainfall import RainfallObservation
from app.signals.config import SignalGates, get_gates
from app.signals.models import SignalKind


AgreementState = Literal[
    "agree",
    "partial",
    "disagree",
    "insufficient_sources",
    "not_comparable",
]


class AgreementSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_name: str
    amount_mm: float = Field(ge=0)
    kind: SignalKind
    is_nasa: bool
    window_hours: int = Field(gt=0)
    observed_end_date: str
    spatial_resolution: str | None = None


class SourceAgreement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: Literal["rain", "soil_moisture"] = "rain"
    state: AgreementState
    sources: list[AgreementSource] = Field(default_factory=list)
    spread_mm: float | None = None
    tolerance_note: str = ""
    summary: str
    assumption_note: str = (
        "Agreement classes compare estimates on the same window. They are a software "
        "classification assumption, not an agronomic threshold, and do not prove that "
        "either estimate is correct."
    )


def _is_nasa(source_name: str) -> bool:
    return "nasa" in source_name.lower() or "imerg" in source_name.lower()


def rain_agreement(
    observations: list[RainfallObservation],
    gates: SignalGates | None = None,
) -> SourceAgreement:
    """Compare independent rainfall estimates that cover the same window.

    Estimates ending on different dates, or covering different window lengths,
    are never compared: a difference between two windows would say nothing
    about source agreement.
    """
    gates = gates or get_gates()
    available = [
        observation
        for observation in observations
        if observation.status == "AVAILABLE"
        and observation.amount_mm is not None
        and observation.provenance is not None
    ]
    if len(available) < 2:
        return SourceAgreement(
            state="insufficient_sources",
            sources=[],
            summary=(
                f"Only {len(available)} independent rainfall estimate(s) are available. "
                "At least two are required to compare sources."
            ),
        )

    groups: dict[tuple[str, int], list[RainfallObservation]] = {}
    for observation in available:
        provenance = observation.provenance
        assert provenance is not None
        key = (provenance.observed_end_utc.date().isoformat(), observation.window_hours)
        groups.setdefault(key, []).append(observation)

    key, group = max(groups.items(), key=lambda item: len(item[1]))
    sources = [
        AgreementSource(
            source_name=observation.provenance.source_name,  # type: ignore[union-attr]
            amount_mm=float(observation.amount_mm),  # type: ignore[arg-type]
            kind=observation.provenance.kind,  # type: ignore[union-attr]
            is_nasa=_is_nasa(observation.provenance.source_name),  # type: ignore[union-attr]
            window_hours=observation.window_hours,
            observed_end_date=key[0],
            spatial_resolution=observation.provenance.spatial_resolution,  # type: ignore[union-attr]
        )
        for observation in group
    ]
    if len(sources) < 2:
        return SourceAgreement(
            state="insufficient_sources",
            sources=sources,
            summary=(
                f"Only one rainfall estimate ends on {key[0]} for a {key[1]}-hour window. "
                "Estimates on different dates are not compared."
            ),
        )

    values = [source.amount_mm for source in sources]
    spread = max(values) - min(values)
    mean = fmean(values)
    tolerance = max(gates.agreement_rain_abs_mm, gates.agreement_rain_rel_fraction * mean)
    tolerance_note = (
        f"Compared on the same {key[1]}-hour window ending {key[0]}. Spread of {spread:.1f} mm; "
        f"the software tolerance is the larger of {gates.agreement_rain_abs_mm:g} mm or "
        f"{gates.agreement_rain_rel_fraction:.0%} of the mean ({tolerance:.1f} mm)."
    )
    if spread <= tolerance:
        state: AgreementState = "agree"
        summary = "Independent rainfall estimates broadly agree on this window."
    elif spread <= 2 * tolerance:
        state = "partial"
        summary = "Independent rainfall estimates partly agree; expect local differences."
    else:
        state = "disagree"
        summary = (
            "Independent rainfall estimates disagree on this window. Do not treat either "
            "estimate as verification of field rainfall."
        )

    return SourceAgreement(
        state=state,
        sources=sources,
        spread_mm=round(spread, 2),
        tolerance_note=tolerance_note,
        summary=summary,
    )


def soil_moisture_agreement() -> SourceAgreement:
    """SMAP volumetric moisture and POWER wetness are not the same quantity."""
    return SourceAgreement(
        topic="soil_moisture",
        state="not_comparable",
        summary=(
            "SMAP L4 reports volumetric soil moisture (m³/m³) while NASA POWER GWETTOP "
            "reports a modeled wetness fraction with a different definition and footprint. "
            "They are shown side by side but are not scored as agreeing or disagreeing."
        ),
        assumption_note="Different physical quantities are never forced into an agreement score.",
    )
