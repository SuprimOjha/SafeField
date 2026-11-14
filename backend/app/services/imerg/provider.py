from app.services.imerg.grid_cache import ImergGridCache
from app.services.rainfall import RainfallObservation, RainfallProvider


class ImergLateProvider:
    """Read-only provider backed by the pre-installed GPM IMERG Late grid cache."""

    def __init__(self, cache: ImergGridCache | None = None) -> None:
        self.cache = cache or ImergGridCache()

    def get_recent_rain(self, latitude: float, longitude: float, hours: int) -> RainfallObservation:
        return self.cache.get_recent_rain(latitude, longitude, hours)
