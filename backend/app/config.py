from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_env: str = "development"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    cache_db_path: str = str(BASE_DIR / "app" / "cache" / "safefield_cache.db")
    http_timeout_seconds: float = 12.0
    earthdata_token: str = ""

    # Nepal bounding box validation (26.3 to 30.5 N, 80.0 to 88.3 E)
    nepal_min_lat: float = 26.3
    nepal_max_lat: float = 30.5
    nepal_min_lon: float = 80.0
    nepal_max_lon: float = 88.3

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
