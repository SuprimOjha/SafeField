from app.cache import create_imerg_cache
from app.services.imerg.grid_cache import ImergGridCache
from app.services.rainfall import RainfallObservation, RainfallProvider


class ImergLateProvider(RainfallProvider):
    """Read-only provider backed by the pre-installed GPM IMERG Late grid cache."""

    def __init__(self, cache: ImergGridCache | None = None) -> None:
        self.cache = cache or create_imerg_cache()

    @property
    def is_available(self) -> bool:
        return self.cache.has_fresh_data()

    def get_recent_rain(self, latitude: float, longitude: float, hours: int, field_polygon: list[tuple[float, float]] | None = None) -> RainfallObservation:
        return self.cache.get_recent_rain(latitude, longitude, hours, field_polygon)
