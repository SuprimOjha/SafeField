"""Background scheduler for the automatic IMERG refresh and retention jobs."""

from __future__ import annotations

import asyncio
import logging

from app.config import Settings, get_settings
from app.ingest.automation import AutomationStatus, run_data_refresh

logger = logging.getLogger(__name__)


class DataRefreshScheduler:
    """Run one refresh after startup, then repeat at the configured interval.

    The first run is delayed so API startup is never blocked by a network
    download. Failures are logged and recorded in the automation status file;
    the loop keeps running so a temporary NASA outage does not stop the app.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    async def _wait(self, stop: asyncio.Event, seconds: float) -> None:
        if seconds <= 0:
            return
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return

    async def run(self, stop: asyncio.Event) -> None:
        await self._wait(stop, self.settings.data_refresh_startup_delay_seconds)
        while not stop.is_set():
            try:
                report: AutomationStatus = await asyncio.to_thread(
                    run_data_refresh, trigger="scheduler"
                )
                logger.info(
                    "Data refresh finished with status %s: %s",
                    report.status,
                    report.message,
                )
            except Exception:  # keep the loop alive; the next run can recover
                logger.exception("Automatic data refresh failed")
            await self._wait(stop, self.settings.data_refresh_interval_hours * 3600)

    async def stop(self, task: asyncio.Task[None] | None, stop: asyncio.Event) -> None:
        if task is None:
            return
        stop.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
