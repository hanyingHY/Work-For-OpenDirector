"""Tests for Issue #473: Import media by reference (zero-copy binding, offline/changed detection, SHA-256 relink, consolidate)."""
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from opendirector.infrastructure.local_projects import LocalProjects
from opendirector_api.main import create_app

HEADERS = {'X-OpenDirector-Request': '1'}


def _png_bytes(color: str = 'navy') -> bytes:
    buf = BytesIO()
    Image.new('RGB', (120, 80), color).save(buf, format='PNG')
    return buf.getvalue()


def _create_project(client: TestClient, session: str, name: str = 'Ref Project') -> str:
    project_id = str(uuid4())
    res = client.post(
        f'/api/creation/projects/{project_id}/commands',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
        json={
            'commandId': str(uuid4()),
            'projectId': project_id,
            'type': 'project.create',
            'expectedVersions': [],
            'payload': {'name': name},
        },
    )
    assert res.status_code == 200, res.text
    assert client.post(
        f'/api/creation/projects/{project_id}/open',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
    ).status_code == 200
    return project_id


def test_reference_import_relink_consolidate_and_zero_copy(tmp_path: Path):
    repo = tmp_path / 'workspace'
    external = tmp_path / 'camera_drive'
    external.mkdir(parents=True)
    source = external / 'drone_shot_01.png'
    original_bytes = _png_bytes('teal')
    source.write_bytes(original_bytes)

    store = LocalProjects(repo)
    client = TestClient(create_app(store))
    session = str(uuid4())
    project_id = _create_project(client, session)

    # 1. Import by reference (zero-copy)
    res = client.post(
        f'/api/creation/projects/{project_id}/assets/reference',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
        json={'path': str(source)},
    )
    assert res.status_code == 200, res.text
    payload = res.json()
    asset_id = payload['asset']['id']
    assert payload['storageMode'] == 'reference'
    assert payload['availability'] == 'online'

    # Verify NO duplicate file was created inside the project's managed assets/ folder
    managed_file = repo / 'projects' / 'Ref Project' / 'assets' / asset_id
    assert not managed_file.exists()

    # 2. Content & range streaming read directly from external source
    content = client.get(f'/api/creation/projects/{project_id}/assets/{asset_id}/content', headers=HEADERS)
    assert content.status_code == 200
    assert content.content == original_bytes

    ranged = client.get(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/content',
        headers={**HEADERS, 'Range': 'bytes=0-15'},
    )
    assert ranged.status_code == 206
    assert ranged.content == original_bytes[:16]

    # Verify /local-path returns the real external file path for native desktop CF_HDROP clipboard (#474)
    local_path_res = client.get(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/local-path',
        headers=HEADERS,
    )
    assert local_path_res.status_code == 200, local_path_res.text
    assert Path(local_path_res.json()['path']).resolve() == source.resolve()
    assert local_path_res.json()['storageMode'] == 'reference'

    # 3. Move the external file -> offline detection
    moved = external / 'moved_drive' / 'drone_shot_01.png'
    moved.parent.mkdir()
    source.rename(moved)

    refs = client.get(f'/api/creation/projects/{project_id}/assets/references', headers=HEADERS).json()['references']
    assert len(refs) == 1
    assert refs[0]['assetId'] == asset_id
    assert refs[0]['availability'] == 'offline'

    offline_read = client.get(f'/api/creation/projects/{project_id}/assets/{asset_id}/content', headers=HEADERS)
    assert offline_read.status_code == 409

    # 4. Attempt to relink with mismatched bytes -> rejected (409)
    wrong = external / 'different.png'
    wrong.write_bytes(_png_bytes('crimson'))
    bad_relink = client.post(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/relink',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
        json={'path': str(wrong)},
    )
    assert bad_relink.status_code == 409

    # 5. Relink with identical SHA-256 at new path -> asset ID & content restored!
    ok_relink = client.post(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/relink',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
        json={'path': str(moved)},
    )
    assert ok_relink.status_code == 200, ok_relink.text
    assert ok_relink.json()['availability'] == 'online'
    restored = client.get(f'/api/creation/projects/{project_id}/assets/{asset_id}/content', headers=HEADERS)
    assert restored.status_code == 200
    assert restored.content == original_bytes

    # 6. Consolidate into managed storage for portable archive
    cons = client.post(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/consolidate',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
    )
    assert cons.status_code == 200, cons.text
    assert cons.json()['storageMode'] == 'managed'
    assert managed_file.is_file()
    assert managed_file.read_bytes() == original_bytes

    # Even if external drive is disconnected now, consolidated project stays readable!
    moved.unlink()
    portable = client.get(f'/api/creation/projects/{project_id}/assets/{asset_id}/content', headers=HEADERS)
    assert portable.status_code == 200
    assert portable.content == original_bytes
    assert client.get(f'/api/creation/projects/{project_id}/assets/references', headers=HEADERS).json()['references'] == []


def test_reference_changed_bytes_detected(tmp_path: Path):
    repo = tmp_path / 'workspace'
    source = tmp_path / 'clip.png'
    source.write_bytes(_png_bytes('blue'))

    store = LocalProjects(repo)
    client = TestClient(create_app(store))
    session = str(uuid4())
    project_id = _create_project(client, session, name='Changed Check')

    res = client.post(
        f'/api/creation/projects/{project_id}/assets/reference',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
        json={'path': str(source)},
    )
    asset_id = res.json()['asset']['id']

    # Overwrite external file with different bytes -> must detect 'changed' and refuse stale read
    source.write_bytes(_png_bytes('gold'))
    refs = client.get(f'/api/creation/projects/{project_id}/assets/references', headers=HEADERS).json()['references']
    assert refs[0]['availability'] == 'changed'
    read_res = client.get(f'/api/creation/projects/{project_id}/assets/{asset_id}/content', headers=HEADERS)
    assert read_res.status_code == 409
