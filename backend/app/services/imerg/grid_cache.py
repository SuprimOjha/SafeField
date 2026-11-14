import sqlite3
import math
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from statistics import median
from app.config import get_settings
from app.services.rainfall import RainfallObservation, RainfallProvenance

TOTAL_DAILY_SAMPLES = 48
MIN_VALID_DAILY_SAMPLES = 39  # ceil(80% of 48 half-hour slots); software quality gate, not a NASA flag.
MIN_POLYGON_COVERAGE = 0.8
MAX_CACHE_AGE_DAYS = 5


def extract_product_version(granule_id: str) -> str:
    """Return the product version encoded in a NASA IMERG granule identifier."""
    match = re.search(r"\.V(\d{2}[A-Z])$", granule_id)
    if not match:
        raise ValueError(f"Cannot determine IMERG product version from granule ID: {granule_id}")
    return match.group(1)


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
            # Correct legacy metadata only when the immutable granule ID proves V07C.
            conn.execute("""UPDATE imerg_daily_cells SET version = '07C'
                WHERE granule_id LIKE '%.V07C' AND version <> '07C'""")

    def _connect(self):
        connection = sqlite3.connect(str(self.db_path), timeout=20.0)
        connection.row_factory = sqlite3.Row
        return connection

    def store_daily_grid(self, day: date, latitudes, longitudes, precipitation, valid_counts, granule_id: str, fetched_at: datetime) -> int:
        rows = []
        product_version = extract_product_version(granule_id)
        for lat_index, latitude in enumerate(latitudes):
            for lon_index, longitude in enumerate(longitudes):
                value = precipitation[lat_index][lon_index]
                count = valid_counts[lat_index][lon_index]
                if value is None or count is None:
                    continue
                try:
                    lat_value, lon_value = float(latitude), float(longitude)
                    rain_value, sample_count = float(value), float(count)
                except (TypeError, ValueError, OverflowError):
                    continue
                if (
                    not all(math.isfinite(item) for item in (lat_value, lon_value, rain_value, sample_count))
                    or not 26.3 <= lat_value <= 30.5
                    or not 80.0 <= lon_value <= 88.3
                    or rain_value < 0
                    or not sample_count.is_integer()
                    or not 1 <= sample_count <= TOTAL_DAILY_SAMPLES
                ):
                    continue
                rows.append((day.isoformat(), lat_value, lon_value, rain_value, int(sample_count), granule_id, "GPM_3IMERGDL", product_version, "LATE", fetched_at.isoformat()))
        with self._connect() as conn:
            conn.executemany("""INSERT OR REPLACE INTO imerg_daily_cells
                (date_utc, latitude, longitude, precipitation_mm_day, valid_samples, granule_id, product, version, stream, fetched_at_utc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
        return len(rows)

    def has_fresh_data(self) -> bool:
        with self._connect() as conn:
            row = conn.execute("SELECT MAX(date_utc) AS latest_date FROM imerg_daily_cells").fetchone()
        if not row or not row["latest_date"]:
            return False
        age_days = (datetime.now(timezone.utc).date() - date.fromisoformat(row["latest_date"])).days
        return 0 <= age_days <= MAX_CACHE_AGE_DAYS

    def get_recent_rain(self, latitude: float, longitude: float, hours: int, field_polygon: list[tuple[float, float]] | None = None) -> RainfallObservation:
        if field_polygon:
            return self._get_polygon_rain(hours, field_polygon)
        return self._get_point_rain(latitude, longitude, hours)

    def _recent_dates(self, hours: int) -> list[date] | RainfallObservation:
        if hours <= 0 or hours % 24:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="Daily IMERG cache supports whole-day windows only.")
        required_days = hours // 24
        with self._connect() as conn:
            rows = conn.execute("SELECT DISTINCT date_utc FROM imerg_daily_cells ORDER BY date_utc DESC LIMIT ?", (required_days + 5,)).fetchall()
        if len(rows) < required_days:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason=f"Only {len(rows)} daily IMERG record(s) are cached; {required_days} consecutive days are required.")
        dates = [date.fromisoformat(row["date_utc"]) for row in rows[:required_days]]
        newest_age_days = (datetime.now(timezone.utc).date() - dates[0]).days
        if newest_age_days < 0 or newest_age_days > MAX_CACHE_AGE_DAYS:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="The newest cached IMERG day is outside the five-day freshness window; no stale rainfall total is used.")
        if any(dates[index] - dates[index + 1] != timedelta(days=1) for index in range(len(dates) - 1)):
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="Cached IMERG daily records contain a date gap; no rolling total is reported.")
        return dates

    def _point_rows(self, latitude: float, longitude: float, dates: list[date]):
        placeholders = ",".join("?" for _ in dates)
        with self._connect() as conn:
            nearest = conn.execute("""SELECT latitude, longitude FROM imerg_daily_cells
                WHERE date_utc = ? ORDER BY ABS(latitude - ?) + ABS(longitude - ?) LIMIT 1""",
                (dates[0].isoformat(), latitude, longitude)).fetchone()
            if nearest is None:
                return None, []
            rows = conn.execute(f"""SELECT * FROM imerg_daily_cells
                WHERE latitude = ? AND longitude = ? AND date_utc IN ({placeholders})
                ORDER BY date_utc DESC""", (nearest["latitude"], nearest["longitude"], *[d.isoformat() for d in dates])).fetchall()
        return nearest, rows

    def _get_point_rain(self, latitude: float, longitude: float, hours: int) -> RainfallObservation:
        dates = self._recent_dates(hours)
        if isinstance(dates, RainfallObservation):
            return dates
        nearest, rows = self._point_rows(latitude, longitude, dates)
        if nearest is None:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="No IMERG grid cells have been installed. Run the fetch-imerg command.")
        by_date = {row["date_utc"]: row for row in rows}
        if any(day.isoformat() not in by_date for day in dates):
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="The nearest IMERG grid cell is missing one or more daily values.")
        selected = [by_date[day.isoformat()] for day in dates]
        if any(int(row["valid_samples"]) < MIN_VALID_DAILY_SAMPLES for row in selected):
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="A point grid cell has fewer than 39 valid half-hour samples in at least one daily granule; no low-coverage daily total is used.")
        amount = sum(float(row["precipitation_mm_day"]) for row in selected)
        return self._build_observation(
            dates, hours, amount, selected, "nearest_grid_cell", None,
            "0.1° (~10 km) grid; nearest cell centre to selected point",
        )

    def _get_polygon_rain(self, hours: int, field_polygon: list[tuple[float, float]]) -> RainfallObservation:
        try:
            from pyproj import Transformer
            from shapely.geometry import Polygon, box
            from shapely.ops import transform as transform_geometry
        except ImportError:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="Polygon rainfall requires Shapely and pyproj; install backend requirements.")
        if len(field_polygon) < 4:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="A field polygon requires at least three vertices and a closed ring.")
        field = Polygon(field_polygon)
        if not field.is_valid or field.area <= 0:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="The supplied field polygon is invalid or has zero area.")
        project = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True).transform
        projected_field = transform_geometry(project, field)
        field_area = projected_field.area
        if field_area <= 0:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="The field polygon has no measurable area after equal-area projection.")

        dates = self._recent_dates(hours)
        if isinstance(dates, RainfallObservation):
            return dates
        placeholders = ",".join("?" for _ in dates)
        with self._connect() as conn:
            rows = conn.execute(f"""SELECT * FROM imerg_daily_cells
                WHERE date_utc IN ({placeholders}) ORDER BY date_utc DESC""",
                [d.isoformat() for d in dates]).fetchall()
        if not rows:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="No cached IMERG grid cells overlap the selected field.")
        lats = sorted({float(row["latitude"]) for row in rows})
        lons = sorted({float(row["longitude"]) for row in rows})
        lat_diffs = [b - a for a, b in zip(lats, lats[1:]) if b > a]
        lon_diffs = [b - a for a, b in zip(lons, lons[1:]) if b > a]
        lat_step = median(lat_diffs) if lat_diffs else 0.1
        lon_step = median(lon_diffs) if lon_diffs else 0.1
        if abs(lat_step - 0.1) > 0.005 or abs(lon_step - 0.1) > 0.005:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="Cached IMERG grid spacing is not the expected 0.1°; polygon aggregation is disabled.")

        daily_totals: list[float] = []
        coverage_fractions: list[float] = []
        selected_granules: set[str] = set()
        fetched_values: list[datetime] = []
        for day in dates:
            day_rows = [row for row in rows if row["date_utc"] == day.isoformat()]
            valid_area = 0.0
            weighted_total = 0.0
            for row in day_rows:
                if row["valid_samples"] <= 0:
                    continue
                cell = box(
                    float(row["longitude"]) - lon_step / 2,
                    float(row["latitude"]) - lat_step / 2,
                    float(row["longitude"]) + lon_step / 2,
                    float(row["latitude"]) + lat_step / 2,
                )
                overlap = projected_field.intersection(transform_geometry(project, cell)).area
                if overlap <= 0:
                    continue
                sample_fraction = min(int(row["valid_samples"]) / TOTAL_DAILY_SAMPLES, 1.0)
                effective_area = overlap * sample_fraction
                valid_area += effective_area
                weighted_total += float(row["precipitation_mm_day"]) * effective_area
                selected_granules.add(row["granule_id"])
                fetched_values.append(datetime.fromisoformat(row["fetched_at_utc"]))
            coverage = min(valid_area / field_area, 1.0)
            coverage_fractions.append(coverage)
            if coverage < MIN_POLYGON_COVERAGE or valid_area <= 0:
                return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason=f"Valid IMERG polygon coverage for {day.isoformat()} is {coverage:.0%}; at least {MIN_POLYGON_COVERAGE:.0%} is required.")
            daily_totals.append(weighted_total / valid_area)

        return self._build_observation(
            dates, hours, sum(daily_totals), rows, "area_weighted_polygon",
            round(min(coverage_fractions), 4),
            f"0.1° (~10 km) grid; equal-area polygon intersection; minimum daily coverage {min(coverage_fractions):.0%}",
            sorted(selected_granules), max(fetched_values),
        )

    def _build_observation(self, dates, hours, amount, rows, spatial_method, coverage, spatial_resolution, granule_ids=None, fetched_at=None):
        selected = rows
        version_rows = [row for row in selected if not granule_ids or row["granule_id"] in granule_ids]
        versions = {str(row["version"]) for row in version_rows}
        if len(versions) != 1:
            return RainfallObservation(status="UNAVAILABLE", window_hours=hours, unavailable_reason="Cached IMERG records contain mixed product versions; no cross-version rainfall total is reported.")
        product_version = next(iter(versions))
        fetched_at = fetched_at or max(datetime.fromisoformat(row["fetched_at_utc"]) for row in selected)
        return RainfallObservation(
            status="AVAILABLE", amount_mm=round(amount, 2), window_hours=hours,
            provenance=RainfallProvenance(
                source_name="NASA GPM IMERG Late Run", kind="observation",
                observed_start_utc=datetime.combine(dates[-1], time.min, tzinfo=timezone.utc),
                observed_end_utc=datetime.combine(dates[0] + timedelta(days=1), time.min, tzinfo=timezone.utc),
                fetched_at_utc=fetched_at, spatial_resolution=spatial_resolution,
                latency_note="Daily Late Run; NASA describes processing about 14 hours after observation. Expected daily-data lag is roughly 14–38 hours, but the actual observed UTC interval and fetch timestamp are authoritative.",
                dataset="GPM_3IMERGDL", version=product_version, stream="LATE",
                granule_ids=granule_ids or sorted({row["granule_id"] for row in selected}),
                units="mm/day summed over complete UTC days",
                spatial_method=spatial_method, coverage_fraction=coverage,
            ),
        )
