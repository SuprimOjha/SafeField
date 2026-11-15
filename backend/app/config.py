from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_PRODUCTION_ORIGINS = (
    "https://safefieldnp.netlify.app",
    "https://safefieldnp.vercel.app",  # Keep the previous deployment working during migration.
)


class Settings(BaseSettings):
    app_env: str = "development"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    cache_db_path: str = str(BASE_DIR / "app" / "cache" / "safefield_cache.db")
    http_timeout_seconds: float = 12.0
    earthdata_token: str = ""
    earthdata_username: str = ""
    earthdata_password: str = ""

    # Automatic data refresh and retention. The refresh installs newly published
    # IMERG days, then removes data older than these windows. Values are
    # conservative design defaults; every deletion keeps the latest window.
    data_refresh_enabled: bool = True
    data_refresh_interval_hours: float = Field(default=6.0, gt=0)
    data_refresh_startup_delay_seconds: float = Field(default=60.0, ge=0)
    imerg_refresh_days: int = Field(default=3, ge=1, le=30)
    imerg_retention_days: int = Field(default=30, ge=1, le=365)
    api_cache_retention_days: int = Field(default=30, ge=1, le=365)
    signal_retention_days: int = Field(default=120, ge=1, le=730)
    automation_status_path: str = str(BASE_DIR / "data" / "automation-status.json")

    # Nepal bounding box validation (26.3 to 30.5 N, 80.0 to 88.3 E)
    nepal_min_lat: float = 26.3
    nepal_max_lat: float = 30.5
    nepal_min_lon: float = 80.0
    nepal_max_lon: float = 88.3

    model_config = SettingsConfigDict(
        # backend/.env wins over the repository-root .env so deployment
        # credentials can live with the backend service.
        env_file=(str(BASE_DIR.parent / ".env"), str(BASE_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        # Keep the deployed farmer frontend allowed even if a hosting
        # environment variable is missing or contains only local origins.
        configured_origins = [
            origin.strip().rstrip("/")
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]
        origins = [*FRONTEND_PRODUCTION_ORIGINS, *configured_origins]
        return list(dict.fromkeys(origins))


@lru_cache
def get_settings() -> Settings:
    return Settings()
