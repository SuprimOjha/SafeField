import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.api.routes import router as api_router
from app.api.signal_routes import router as signal_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    stop = asyncio.Event()
    scheduler = None
    task = None
    running_tests = bool(os.environ.get("PYTEST_CURRENT_TEST")) or settings.app_env == "test"
    if settings.supabase_storage_enabled and settings.supabase_restore_on_startup:
        from app.storage.sync import restore_from_storage

        try:
            report = await asyncio.to_thread(restore_from_storage, settings)
            if report.status == "error":
                logger.warning("Supabase Storage restore failed: %s", report.error)
            else:
                logger.info(
                    "Supabase Storage restore downloaded %s file(s).",
                    report.downloaded_files,
                )
        except Exception:  # startup must not fail because a remote copy is unavailable
            logger.exception("Supabase Storage restore failed")
    if settings.data_refresh_enabled and not running_tests:
        from app.ingest.scheduler import DataRefreshScheduler

        scheduler = DataRefreshScheduler(settings)
        task = asyncio.create_task(scheduler.run(stop))
        app.state.refresh_task = task
    try:
        yield
    finally:
        if scheduler is not None:
            await scheduler.stop(task, stop)
        if settings.postgres_cache_enabled:
            from app.cache.postgres_cache import close_postgres_pools

            close_postgres_pools()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Safe Field Nepal API",
        description="NASA Earth-observation proxy, statistical shift detector, and fertilizer timing decision support.",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    app.include_router(signal_router)

    @app.get("/api/health")
    async def health_check() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "safe-field-nepal-backend",
            "environment": settings.app_env,
        }

    return app


app = create_app()