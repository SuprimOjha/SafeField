from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.api.routes import router as api_router
from app.api.signal_routes import router as signal_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    yield


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