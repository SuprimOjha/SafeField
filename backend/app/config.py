from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

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

    # Optional Supabase storage. When SUPABASE_DB_URL is set, cached API
    # responses and IMERG grid cells live in Supabase Postgres instead of the
    # local SQLite file. When SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
    # set, snapshot and raw data files are mirrored to Supabase Storage.
    # Without these variables the app runs exactly as before on local disk.
    supabase_db_url: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "safefield-data"
    supabase_restore_on_startup: bool = True

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
    def postgres_cache_enabled(self) -> bool:
        return bool(self.supabase_db_url.strip())

    @property
    def supabase_storage_enabled(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_service_role_key.strip())

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


def redact_secrets(message: str, settings: Settings) -> str:
    """Remove credentials from an error message before it is logged or stored."""
    secrets = [
        settings.earthdata_token,
        settings.earthdata_username,
        settings.earthdata_password,
        settings.supabase_service_role_key,
    ]
    if settings.supabase_db_url:
        secrets.append(settings.supabase_db_url)
        try:
            password = urlsplit(settings.supabase_db_url).password
        except ValueError:
            password = None
        if password:
            secrets.append(password)
    redacted = message
    for secret in secrets:
        if secret and len(secret) >= 3:
            redacted = redacted.replace(secret, "[redacted]")
    return redacted
