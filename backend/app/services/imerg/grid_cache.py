import sqlite3
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from app.config import get_settings
from app.services.rainfall import RainfallObservation, RainfallProvenance


class ImergGridCache:
    """Persistent daily IMERG grid-cell cache; API reads never download granules."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = Path(db_path or get_settings().cache_db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS imerg_daily_cells (
                date_utc TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
                precipitation_mm_day REAL NOT NULL, valid_samples INTEGER NOT NULL,
                granule_id TEXT NOT NULL, product TEXT NOT NULL, version TEXT NOT NULL,
                stream TEXT NOT NULL, fetched_at_utc TEXT NOT NULL,
                PRIMARY KEY(date_utc, latitude, longitude, granule_id)
            )""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_imerg_daily_location ON imerg_daily_cells(latitude, longitude, date_utc)")

    def _connect(self):
        connection = sqlite3.connect(str(self.db_path), timeout=20.0)
        connection.row_factory = sqlite3.Row
        return connection

    def store_daily_grid(self, day: date, latitudes, longitudes, precipitation, valid_counts, granule_id: str, fetched_at: datetime) -> int:
        rows = []
        for lat_index, latitude in enumerate(latitudes):
            for lon_index, longitude in enumerate(longitudes):
                value = precipitation[lat_index][lon_index]
                count = valid_counts[lat_index][lon_index]
                if value is None or count is None or count <= 0 or value < 0:
                    continue
                rows.append((day.isoformat(), float(latitude), float(longitude), float(value), int(count), granule_id, "GPM_3IMERGDL", "07B", "LATE", fetched_at.isoformat()))
        with self._connect() as conn:
            conn.executemany("""INSERT OR REPLACE INTO imerg_daily_cells
                (date_utc, latitude, longitude, precipitation_mm_day, valid_samples, granule_id, product, version, stream, fetched_at_utc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
        return len(rows)

    def get_recent_rain(self, latitude: float, longitude: float, hours: int) -> RainfallObservation:
        if hours <= 0 or hours % 24:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="Daily IMERG cache supports whole-day windows only.")
        required_days = hours // 24
        with self._connect() as conn:
            nearest = conn.execute("""SELECT latitude, longitude FROM imerg_daily_cells
                ORDER BY ABS(latitude - ?) + ABS(longitude - ?) LIMIT 1""", (latitude, longitude)).fetchone()
            if nearest is None:
                return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="No IMERG grid cells have been installed. Run the fetch-imerg command.")
            rows = conn.execute("""SELECT * FROM imerg_daily_cells
                WHERE latitude = ? AND longitude = ? ORDER BY date_utc DESC LIMIT ?""",
                (nearest["latitude"], nearest["longitude"], required_days + 5)).fetchall()
        if len(rows) < required_days:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason=f"Only {len(rows)} daily IMERG record(s) are cached; {required_days} consecutive days are required.")
        selected = rows[:required_days]
        dates = [date.fromisoformat(row["date_utc"]) for row in selected]
        if any(dates[index] - dates[index + 1] != timedelta(days=1) for index in range(len(dates) - 1)):
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="Cached IMERG daily records contain a date gap; no rolling total is reported.")
        amount = sum(float(row["precipitation_mm_day"]) for row in selected)
        start_day = dates[-1]
        end_day = dates[0] + timedelta(days=1)
        fetched_at = max(datetime.fromisoformat(row["fetched_at_utc"]) for row in selected)
        return RainfallObservation(
            status="AVAILABLE", amount_mm=round(amount, 2), window_hours=hours,
            provenance=RainfallProvenance(
                source_name="NASA GPM IMERG Late Run", kind="observation",
                observed_start_utc=datetime.combine(start_day, time.min, tzinfo=timezone.utc),
                observed_end_utc=datetime.combine(end_day, time.min, tzinfo=timezone.utc),
                fetched_at_utc=fetched_at, spatial_resolution="0.1° (~10 km)",
                latency_note="Daily Late Run. The observed UTC interval and fetch timestamp are authoritative; publication delay varies.",
                dataset="GPM_3IMERGDL", version="07B", stream="LATE",
                granule_ids=sorted({row["granule_id"] for row in selected}), units="mm/day summed over complete UTC days",
            ),
        )
