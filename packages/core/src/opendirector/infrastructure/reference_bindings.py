"""Host-local file bindings for reference-imported media assets (Issue #473).

Bindings live under ``<repository>/.opendirector/reference-bindings.json``,
strictly outside individual project directories so portable archives never
carry machine-specific file paths or local grants.
"""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
from threading import Lock
from uuid import UUID

from opendirector.infrastructure.creation_files import file_identity
from opendirector.infrastructure.local_projects import child, read_json, write_json


class ReferenceBindings:
    """Thread-safe host-local registry mapping (project_id, asset_id) -> source path."""

    def __init__(self, repository: Path) -> None:
        self.repository = Path(repository)
        self._dir = self.repository / '.opendirector'
        self._path = self._dir / 'reference-bindings.json'
        self._lock = Lock()

    def _load(self) -> dict[str, dict[str, dict]]:
        if not self._path.is_file():
            return {}
        try:
            data = read_json(self._path)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, data: dict[str, dict[str, dict]]) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        write_json(self._path, data)

    def bind(
        self,
        project_id: UUID | str,
        asset_id: UUID | str,
        *,
        source_path: Path | str,
        fingerprint: str,
        size: int,
    ) -> dict:
        resolved = str(Path(source_path).resolve())
        stat = os.stat(resolved)
        entry = {
            'sourcePath': resolved,
            'fingerprint': fingerprint,
            'size': int(size),
            'mtimeNs': stat.st_mtime_ns,
            'boundAt': datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            data = self._load()
            proj = data.setdefault(str(project_id), {})
            proj[str(asset_id)] = entry
            self._save(data)
        return dict(entry)

    def get(self, project_id: UUID | str, asset_id: UUID | str) -> dict | None:
        with self._lock:
            data = self._load()
            entry = data.get(str(project_id), {}).get(str(asset_id))
            return dict(entry) if isinstance(entry, dict) else None

    def list_project(self, project_id: UUID | str) -> dict[str, dict]:
        with self._lock:
            data = self._load()
            proj = data.get(str(project_id), {})
            return {k: dict(v) for k, v in proj.items() if isinstance(v, dict)}

    def unbind(self, project_id: UUID | str, asset_id: UUID | str) -> bool:
        with self._lock:
            data = self._load()
            proj = data.get(str(project_id))
            if not proj or str(asset_id) not in proj:
                return False
            del proj[str(asset_id)]
            if not proj:
                del data[str(project_id)]
            self._save(data)
            return True

    def check_availability(
        self,
        entry: dict,
        *,
        expected_fingerprint: str,
        expected_size: int,
    ) -> str:
        """Return 'online', 'offline', or 'changed' for a bound source file."""
        source = Path(entry['sourcePath'])
        if not source.is_file():
            return 'offline'
        try:
            stat = source.stat()
            if stat.st_size != expected_size:
                return 'changed'
            if stat.st_mtime_ns == entry.get('mtimeNs') and entry.get('fingerprint') == expected_fingerprint:
                return 'online'
            fingerprint, size = file_identity(source)
            if fingerprint == expected_fingerprint and size == expected_size:
                return 'online'
            return 'changed'
        except OSError:
            return 'offline'


def ensure_managed_asset_path(project_path: Path, asset_id: UUID | str) -> Path:
    assets_dir = child(project_path, 'assets')
    assets_dir.mkdir(exist_ok=True)
    return child(assets_dir, str(asset_id))
