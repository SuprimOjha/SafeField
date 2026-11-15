import json
import time
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.cache import create_cache, create_imerg_cache
from app.cache.postgres_cache import (
    PgConnection,
    PostgresCache,
    PostgresImergGridCache,
    qualify_tables,
    to_pg_placeholders,
)
from app.cache.sqlite_cache import SQLiteCache
from app.config import Settings
from app.ingest.automation import run_data_refresh
from app.services.imerg.grid_cache import ImergGridCache
from app.storage import sync as storage_sync
from app.storage.bootstrap import initialize_data_storage
from app.storage.supabase_storage import SupabaseStorage, SupabaseStorageError
from app.storage.sync import (
    StorageSyncReport,
    delete_remote_before,
    restore_directory,
    restore_down,
    sync_up,
    upload_directory,
)

TODAY = date(2026, 11, 15)


def bare_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "cache_db_path": str(tmp_path / "cache.db"),
        "automation_status_path": str(tmp_path / "automation-status.json"),
        "supabase_db_url": "",
        "supabase_url": "",
        "supabase_service_role_key": "",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class FakeCursor:
    rowcount = 0

    def __init__(self, connection):
        self.connection = connection
        self._rows = None

    def fetchone(self):
        return self.connection.row

    def fetchall(self):
        return self.connection.rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def executemany(self, sql, rows):
        self.connection.calls.append((sql, list(rows)))


class FakeRawConnection:
    def __init__(self):
        self.calls = []
        self.rows = []
        self.row = None
        self.commits = 0
        self.rollbacks = 0

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        cursor = FakeCursor(self)
        cursor.rowcount = 1
        return cursor

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakePool:
    def __init__(self, connection):
        self._connection = connection
        self.returned = 0

    def connection(self):
        pool = self

        class Context:
            def __enter__(self):
                return pool._connection

            def __exit__(self, exc_type, exc, traceback):
                pool.returned += 1
                return False

        return Context()


def test_pg_placeholders_are_translated():
    assert to_pg_placeholders("SELECT 1 WHERE a = ? AND b IN (?, ?)") == (
        "SELECT 1 WHERE a = %s AND b IN (%s, %s)"
    )


def test_pg_tables_are_schema_qualified_for_transaction_poolers():
    sql = qualify_tables(
        "INSERT INTO api_cache (cache_key) VALUES (?) "
        "ON CONFLICT (cache_key) DO UPDATE SET payload_json = ?"
    )
    assert "INTO safefield.api_cache" in sql
    assert qualify_tables("CREATE INDEX i ON imerg_daily_cells(latitude)") == (
        "CREATE INDEX i ON safefield.imerg_daily_cells(latitude)"
    )
    assert qualify_tables("SELECT * FROM safefield.api_cache") == (
        "SELECT * FROM safefield.api_cache"
    )


def test_insert_dialects_use_the_native_upsert():
    sqlite_sql = object.__new__(ImergGridCache)._insert_cells_sql()
    postgres_sql = object.__new__(PostgresImergGridCache)._insert_cells_sql()

    assert "INSERT OR REPLACE" in sqlite_sql
    assert "ON CONFLICT (date_utc, latitude, longitude, granule_id) DO UPDATE" in postgres_sql


def test_factory_keeps_sqlite_without_supabase(tmp_path):
    settings = bare_settings(tmp_path)

    assert isinstance(create_cache(settings), SQLiteCache)
    assert isinstance(create_imerg_cache(settings), ImergGridCache)


def test_factory_selects_postgres_when_url_is_set(tmp_path, monkeypatch):
    monkeypatch.setattr(PostgresCache, "_init_db", lambda self: None)
    monkeypatch.setattr(PostgresImergGridCache, "_init_db", lambda self: None)
    settings = bare_settings(tmp_path, supabase_db_url="postgresql://user:pass@db.example/postgres")

    assert isinstance(create_cache(settings), PostgresCache)
    assert isinstance(create_imerg_cache(settings), PostgresImergGridCache)


def test_pg_connection_translates_placeholders_and_commits(tmp_path, monkeypatch):
    raw = FakeRawConnection()
    raw.row = {
        "payload_json": json.dumps({"value": 1}),
        "fetched_at_utc": "2026-11-15T00:00:00Z",
        "created_epoch": time.time(),
        "ttl_seconds": 3600,
    }
    monkeypatch.setattr("app.cache.postgres_cache._connection_pool", lambda url: FakePool(raw))

    cache = PostgresCache(
        settings=bare_settings(tmp_path, supabase_db_url="postgresql://user:pass@db.example/postgres")
    )
    cache.set("power:test", {"value": 1}, "2026-11-15T00:00:00Z", 3600)
    result = cache.get("power:test")

    assert "CREATE SCHEMA IF NOT EXISTS safefield" in raw.calls[0][0]
    assert "SET search_path TO safefield, public" in raw.calls[1][0]
    insert_calls = [call for call in raw.calls if "INSERT INTO safefield.api_cache" in call[0]]
    assert insert_calls and "%s" in insert_calls[0][0]
    assert "?" not in insert_calls[0][0]
    assert raw.commits >= 2
    assert result is not None and result[0] == {"value": 1}


def test_pg_connection_rolls_back_on_error(tmp_path, monkeypatch):
    raw = FakeRawConnection()

    def explode(sql, params=None):
        raise RuntimeError("boom")

    raw.execute = explode
    monkeypatch.setattr("app.cache.postgres_cache._connection_pool", lambda url: FakePool(raw))

    with pytest.raises(RuntimeError):
        PgConnection("postgresql://user:pass@db.example/postgres")

    assert raw.rollbacks == 1


class FakeStorage:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.bucket_checks = 0
        self.uploads = []
        self.deletes = []

    def ensure_bucket(self):
        self.bucket_checks += 1

    def list_names(self, prefix):
        return {key: size for key, size in self.objects.items() if key.startswith(prefix)}

    def upload_bytes(self, path, data, content_type):
        self.uploads.append((path, content_type))
        self.objects[path] = len(data)

    def download_bytes(self, path):
        return b"remote:" + path.encode()

    def delete_objects(self, paths):
        self.deletes.extend(paths)
        for path in paths:
            self.objects.pop(path, None)
        return len(paths)


def make_storage_client(handler, bucket="safefield-data"):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return SupabaseStorage("https://demo.supabase.co", "service-role-secret", bucket, client=client)


def test_storage_upload_uses_upsert_and_never_leaks_key():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"Key": "bucket/file"})

    storage = make_storage_client(handler)
    storage.upload_bytes("signals/smap/2026-11-14.json", b"{}", "application/json")

    request = seen[0]
    assert request.method == "POST"
    assert str(request.url).endswith("/storage/v1/object/safefield-data/signals/smap/2026-11-14.json")
    assert request.headers["x-upsert"] == "true"
    assert request.headers["authorization"] == "Bearer service-role-secret"


def test_storage_list_paginates_and_downloads():
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("/object/list/safefield-data"):
            offset = json.loads(request.content)["offset"]
            if offset == 0:
                return httpx.Response(
                    200,
                    json=[
                        {"name": f"file-{index}.json", "id": "x", "metadata": {"size": 10}}
                        for index in range(1000)
                    ],
                )
            return httpx.Response(
                200, json=[{"name": "last.json", "id": "x", "metadata": {"size": 4}}]
            )
        return httpx.Response(200, content=b"payload")

    storage = make_storage_client(handler)
    names = storage.list_names("signals/smap")

    assert len(names) == 1001
    assert names["signals/smap/last.json"] == 4
    assert len(calls) == 2
    assert storage.download_bytes("signals/smap/last.json") == b"payload"


def test_storage_errors_hide_the_service_key():
    def handler(request):
        return httpx.Response(401, json={"message": "denied"})

    storage = make_storage_client(handler)
    with pytest.raises(SupabaseStorageError) as error:
        storage.upload_bytes("x.json", b"{}", "application/json")

    assert "401" in str(error.value)
    assert "service-role-secret" not in str(error.value)


def test_upload_directory_skips_unchanged_and_force_reuploads(tmp_path):
    local = tmp_path / "signals" / "smap"
    local.mkdir(parents=True)
    target = local / "2026-11-14.json"
    target.write_text("{}", encoding="utf-8")
    storage = FakeStorage({f"signals/smap/2026-11-14.json": 2})
    report = StorageSyncReport()

    upload_directory(storage, local, "signals/smap", report)
    assert report.uploaded_files == 0

    upload_directory(storage, local, "signals/smap", report, force=True)
    assert report.uploaded_files == 1
    assert ("signals/smap/2026-11-14.json", "application/json") in storage.uploads


def test_restore_directory_only_downloads_missing_files(tmp_path):
    local = tmp_path / "signals" / "smap"
    local.mkdir(parents=True)
    (local / "2026-11-13.json").write_text("local", encoding="utf-8")
    storage = FakeStorage(
        {
            "signals/smap/2026-11-13.json": 5,
            "signals/smap/2026-11-14.json": 5,
        }
    )
    report = StorageSyncReport()

    restore_directory(storage, local, "signals/smap", report)

    assert report.downloaded_files == 1
    assert (local / "2026-11-14.json").read_bytes().startswith(b"remote:")


def test_delete_remote_before_removes_only_expired_days():
    storage = FakeStorage(
        {
            "signals/smap/2026-09-01.json": 2,
            "signals/smap/2026-11-14.json": 2,
        }
    )
    report = StorageSyncReport()

    delete_remote_before(
        storage,
        "signals/smap",
        date(2026, 10, 16),
        report,
        parse_date=storage_sync._date_from_json_key,
    )

    assert report.deleted_files == 1
    assert storage.deletes == ["signals/smap/2026-09-01.json"]


def test_sync_up_mirrors_signals_incoming_and_raw(tmp_path, monkeypatch):
    signals = tmp_path / "signals"
    incoming = tmp_path / "incoming"
    raw = tmp_path / "raw"
    for directory, name in (
        (signals / "smap", "2026-11-14.json"),
        (incoming / "smap", "2026-11-14.json"),
        (raw, "3B-DAY-L.MS.MRG.3IMERG.20261114-S000000-E235959.V07C.nc4"),
    ):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / name).write_bytes(b"data")
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(incoming))
    storage = FakeStorage()
    settings = bare_settings(tmp_path)

    report = sync_up(settings, root=signals, raw_dir=raw, storage=storage)

    assert report.status == "ok"
    assert report.uploaded_files == 3
    assert storage.bucket_checks == 1
    assert "signals/smap/2026-11-14.json" in storage.objects
    assert "incoming/smap/2026-11-14.json" in storage.objects
    assert "imerg/raw/3B-DAY-L.MS.MRG.3IMERG.20261114-S000000-E235959.V07C.nc4" in storage.objects


def test_restore_down_restores_only_missing_json(tmp_path, monkeypatch):
    signals = tmp_path / "signals"
    incoming = tmp_path / "incoming"
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(incoming))
    storage = FakeStorage(
        {
            "signals/smap/2026-11-14.json": 4,
            "incoming/lst/2026-11-14.json": 4,
        }
    )
    settings = bare_settings(tmp_path)

    report = restore_down(settings, root=signals, storage=storage)

    assert report.status == "ok"
    assert report.downloaded_files == 2
    assert (signals / "smap" / "2026-11-14.json").exists()
    assert (incoming / "lst" / "2026-11-14.json").exists()


def test_refresh_reports_storage_upload_and_prune(tmp_path, monkeypatch):
    settings = bare_settings(
        tmp_path,
        earthdata_username="pilot@example.test",
        earthdata_password="secret-value",
        imerg_refresh_days=1,
    )
    signals = tmp_path / "signals"
    incoming = tmp_path / "incoming"
    raw = tmp_path / "raw"
    (signals / "smap").mkdir(parents=True)
    (signals / "smap" / "2026-11-14.json").write_text("{}", encoding="utf-8")
    (signals / "smap" / "2026-09-01.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(incoming))
    raw.mkdir()
    (raw / "3B-DAY-L.MS.MRG.3IMERG.20261001-S000000-E235959.V07C.nc4").write_bytes(b"old")
    storage = FakeStorage({"signals/smap/2026-09-01.json": 2})

    def fake_fetch(days, cache):
        return {
            "status": "ok",
            "processed": [{"date_utc": "2026-11-14", "granule_id": "granule.V07C"}],
            "skipped_dates": [],
        }

    report = run_data_refresh(
        settings=settings,
        fetch_fn=fake_fetch,
        today_utc=TODAY,
        root=signals,
        imerg_raw_dir=raw,
        signal_retention_days=30,
        imerg_retention_days=30,
        storage=storage,
    )

    assert report.status == "ok"
    assert report.storage.status == "ok"
    assert report.storage.uploaded_files == 1  # only the retained snapshot is left
    assert report.storage.deleted_files == 1
    assert "signals/smap/2026-09-01.json" in storage.deletes


def test_storage_failure_does_not_hide_installed_data(tmp_path):
    settings = bare_settings(
        tmp_path,
        earthdata_username="pilot@example.test",
        earthdata_password="secret-value",
        imerg_refresh_days=1,
    )

    class BrokenStorage(FakeStorage):
        def ensure_bucket(self):
            raise SupabaseStorageError("Supabase Storage bucket lookup failed with HTTP 503")

    def fake_fetch(days, cache):
        return {
            "status": "ok",
            "processed": [{"date_utc": "2026-11-14", "granule_id": "granule.V07C"}],
            "skipped_dates": [],
        }

    report = run_data_refresh(
        settings=settings,
        fetch_fn=fake_fetch,
        today_utc=TODAY,
        root=tmp_path / "signals",
        imerg_raw_dir=tmp_path / "raw",
        storage=BrokenStorage(),
    )

    assert report.status == "partial"
    assert report.imerg.installed_dates == ["2026-11-14"]
    assert report.storage.status == "error"
    assert "503" in (report.storage.error or "")
    assert settings.earthdata_password not in (report.storage.error or "")


def test_status_json_is_mirrored_and_restored(tmp_path, monkeypatch):
    signals = tmp_path / "signals"
    incoming = tmp_path / "incoming"
    raw = tmp_path / "raw"
    incoming.mkdir(parents=True)
    raw.mkdir()
    status_file = tmp_path / "status.json"
    status_file.write_text('{"sources": {}}', encoding="utf-8")
    monkeypatch.setenv("SAFEFIELD_INCOMING_DIR", str(incoming))
    monkeypatch.setattr(storage_sync, "status_path", lambda: status_file)
    storage = FakeStorage()
    settings = bare_settings(tmp_path)

    uploaded = sync_up(settings, root=signals, raw_dir=raw, storage=storage)

    assert uploaded.status == "ok"
    assert uploaded.uploaded_files == 1
    assert "status.json" in storage.objects

    status_file.unlink()
    restored = restore_down(settings, root=signals, storage=storage)

    assert restored.downloaded_files == 1
    assert status_file.exists()


def test_initialize_data_storage_reports_disabled(tmp_path):
    report = initialize_data_storage(bare_settings(tmp_path), restore=False)

    assert report.postgres == "disabled"
    assert report.storage == "disabled"
    assert report.error is None


def test_initialize_data_storage_redacts_postgres_secret(tmp_path, monkeypatch):
    secret = "supersecret-value"
    settings = bare_settings(
        tmp_path, supabase_db_url=f"postgresql://user:{secret}@db.example/postgres"
    )

    def explode(_settings):
        raise RuntimeError(
            f"could not connect to postgresql://user:{secret}@db.example/postgres"
        )

    monkeypatch.setattr("app.storage.bootstrap.create_cache", explode)

    report = initialize_data_storage(settings, restore=False)

    assert report.postgres == "error"
    assert secret not in (report.error or "")
    assert "[redacted]" in (report.error or "")


def test_initialize_data_storage_reports_restore_error(tmp_path, monkeypatch):
    settings = bare_settings(
        tmp_path,
        supabase_url="https://project.supabase.co",
        supabase_service_role_key="service-role-value",
    )
    monkeypatch.setattr(
        "app.storage.bootstrap.restore_from_storage",
        lambda _settings: StorageSyncReport(status="error", error="HTTP 403 for bucket"),
    )

    report = initialize_data_storage(settings)

    assert report.storage == "error"
    assert "HTTP 403" in (report.error or "")


def test_initialize_data_storage_checks_bucket_without_restore(tmp_path, monkeypatch):
    settings = bare_settings(
        tmp_path,
        supabase_url="https://project.supabase.co",
        supabase_service_role_key="service-role-value",
    )

    class BucketStorage:
        def __init__(self):
            self.checked = 0
            self.closed = 0

        def ensure_bucket(self):
            self.checked += 1

        def close(self):
            self.closed += 1

    storage = BucketStorage()
    monkeypatch.setattr("app.storage.bootstrap.get_storage", lambda _settings: storage)

    report = initialize_data_storage(settings, restore=False)

    assert report.storage == "ok"
    assert storage.checked == 1
    assert storage.closed == 1
