"""Minimal Supabase Storage client over the documented REST API.

Only the operations this project needs are implemented: bucket creation,
listing, upload, download and delete. Requests are authenticated with the
service-role key, which is read from the environment and never logged.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx


class SupabaseStorageError(RuntimeError):
    """Supabase Storage returned an error; the message never contains the key."""


class SupabaseStorage:
    def __init__(
        self,
        base_url: str,
        service_role_key: str,
        bucket: str,
        *,
        client: httpx.Client | None = None,
        timeout_seconds: float = 20.0,
    ) -> None:
        base = base_url.rstrip("/")
        if not base or not service_role_key.strip():
            raise ValueError("Supabase URL and service-role key are required for storage.")
        self.bucket = bucket
        self._bucket_api = f"{base}/storage/v1/bucket"
        self._object_api = f"{base}/storage/v1/object"
        self._headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }
        self._client = client or httpx.Client(timeout=timeout_seconds)
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "SupabaseStorage":
        return self

    def __exit__(self, exc_type, exc, traceback) -> bool:
        self.close()
        return False

    def _check(self, response: httpx.Response, action: str, path: str = "") -> httpx.Response:
        if response.status_code < 400:
            return response
        detail = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                detail = str(payload.get("message") or payload.get("error") or "")[:200]
        except ValueError:
            detail = response.text[:200]
        suffix = f" for {path}" if path else ""
        raise SupabaseStorageError(
            f"Supabase Storage {action} failed with HTTP {response.status_code}{suffix}"
            + (f": {detail}" if detail else "")
        )

    def ensure_bucket(self) -> None:
        response = self._client.get(f"{self._bucket_api}/{quote(self.bucket)}", headers=self._headers)
        if response.status_code == 200:
            return
        if response.status_code not in (404, 400):
            self._check(response, "bucket lookup")
        created = self._client.post(
            self._bucket_api,
            headers=self._headers,
            json={"id": self.bucket, "name": self.bucket, "public": False},
        )
        if created.status_code in (200, 201):
            return
        if created.status_code in (400, 409):
            # Another process created it between the lookup and the insert.
            return
        self._check(created, "bucket creation")

    def list_names(self, prefix: str = "") -> dict[str, int | None]:
        """Return {object path: size in bytes} for a folder, across pages."""
        names: dict[str, int | None] = {}
        offset = 0
        page_size = 1000
        while True:
            body: dict[str, Any] = {
                "prefix": prefix,
                "limit": page_size,
                "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            }
            response = self._client.post(
                f"{self._object_api}/list/{quote(self.bucket)}",
                headers=self._headers,
                json=body,
            )
            self._check(response, "list", prefix or "/")
            entries = response.json() or []
            if not isinstance(entries, list):
                raise SupabaseStorageError("Supabase Storage list returned an unexpected payload.")
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                name = str(entry.get("name") or "")
                if not name or entry.get("id") is None:
                    continue  # virtual folder placeholder
                path = name if "/" in name else f"{prefix.rstrip('/')}/{name}" if prefix else name
                metadata = entry.get("metadata")
                size = metadata.get("size") if isinstance(metadata, dict) else None
                names[path] = int(size) if isinstance(size, (int, float)) else None
            if len(entries) < page_size:
                break
            offset += page_size
        return names

    def upload_bytes(self, path: str, data: bytes, content_type: str) -> None:
        response = self._client.post(
            f"{self._object_api}/{quote(self.bucket)}/{quote(path, safe='/')}",
            headers={**self._headers, "x-upsert": "true", "Content-Type": content_type},
            content=data,
        )
        self._check(response, "upload", path)

    def download_bytes(self, path: str) -> bytes:
        response = self._client.get(
            f"{self._object_api}/{quote(self.bucket)}/{quote(path, safe='/')}",
            headers=self._headers,
        )
        self._check(response, "download", path)
        return response.content

    def delete_objects(self, paths: list[str]) -> int:
        if not paths:
            return 0
        response = self._client.request(
            "DELETE",
            f"{self._object_api}/{quote(self.bucket)}",
            headers=self._headers,
            json={"prefixes": paths},
        )
        self._check(response, "delete")
        return len(paths)


def content_type_for(path: str) -> str:
    return "application/json" if path.lower().endswith(".json") else "application/octet-stream"
