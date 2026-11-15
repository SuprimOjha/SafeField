from app.schemas import PowerSummaryResponse
from app.services.imerg.provider import ImergLateProvider
from app.services.open_meteo_past_client import get_recent_rain_reanalysis
from app.services.rainfall import RainfallObservation


def resolve_recent_rainfall(
    latitude: float,
    longitude: float,
    power_summary: PowerSummaryResponse,
    hours: int = 72,
    field_polygon: list[tuple[float, float]] | None = None,
) -> tuple[RainfallObservation, list[RainfallObservation]]:
    """Pick the best available local rainfall estimate and keep every candidate.

    Installed IMERG Late cells win. Otherwise Open-Meteo's reanalysis past-days
    total is used with honest model provenance. NASA POWER stays context-only
    and is never promoted to an on-field observation. The candidate list is for
    source-agreement display; it never changes the chosen value.
    """
    candidates: list[RainfallObservation] = []
    observation = ImergLateProvider().get_recent_rain(latitude, longitude, hours, field_polygon)
    candidates.append(observation)
    if observation.status == "AVAILABLE":
        return observation, candidates

    reanalysis = get_recent_rain_reanalysis(latitude, longitude, hours)
    candidates.append(reanalysis)
    if reanalysis.status == "AVAILABLE":
        return reanalysis, candidates

    power_records = [
        record for record in power_summary.recent_daily_records if record.precip_mm is not None
    ][-3:]
    power_dates = [record.date for record in power_records]
    power_context = (
        f" NASA POWER regional estimate: {power_summary.rain_last_72h_mm} mm "
        f"across available daily records {', '.join(power_dates)} "
        f"({power_summary.freshness.spatial_resolution}); this coarse reanalysis "
        "is not verification of rainfall at the selected field."
        if power_summary.rain_last_72h_mm is not None and len(power_records) == 3
        else ""
    )
    unavailable = RainfallObservation(
        status="UNAVAILABLE",
        amount_mm=None,
        window_hours=hours,
        provenance=None,
        unavailable_reason=(
            "No usable local-scale rainfall observation is available "
            "for the selected field and requested window."
            + (f" {reanalysis.unavailable_reason}" if reanalysis.unavailable_reason else "")
            + power_context
        ),
    )
    candidates.append(unavailable)
    return unavailable, candidates
