"""Tests for v0.4/v0.5 local FFmpeg media probe, scene breakdown, tail-frame extraction, local video ops, and NLE exports."""
from __future__ import annotations

import os
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from opendirector.infrastructure.local_projects import LocalProjects
from opendirector_api.main import create_app


pytestmark = pytest.mark.cpu


def _ffmpeg_path() -> str | None:
    home_ff = Path.home() / 'bin' / 'ffmpeg'
    if home_ff.exists():
        return str(home_ff)
    import shutil
    return shutil.which('ffmpeg')


def _make_two_scene_video(out_path: Path) -> None:
    ffmpeg = _ffmpeg_path()
    assert ffmpeg is not None, 'ffmpeg binary required for media_probe test'
    # 1s blue scene + 1s bright orange scene (clear scene cut at 1.0s)
    subprocess.run(
        [
            ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=c=0x102060:s=320x180:d=1.0:r=25',
            '-f', 'lavfi', '-i', 'color=c=0xf59e0b:s=320x180:d=1.0:r=25',
            '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
            '-map', '[v]',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            str(out_path),
        ],
        check=True,
    )


def _headers(session_id: str | None = None) -> dict[str, str]:
    base = {
        'Origin': 'http://127.0.0.1:5173',
        'X-OpenDirector-Request': '1',
    }
    if session_id:
        base['X-OpenDirector-Session'] = session_id
    return base


def test_media_probe_scene_extract_local_video_op_and_nle_export(tmp_path: Path, monkeypatch):
    monkeypatch.setenv('PATH', f"{Path.home() / 'bin'}:{os.environ.get('PATH', '')}")

    app = create_app(LocalProjects(tmp_path / 'workspace'))
    client = TestClient(app)

    project_id = str(uuid4())
    session_id = str(uuid4())
    create_res = client.post(
        f'/api/creation/projects/{project_id}/commands',
        headers=_headers(session_id),
        json={
            'commandId': str(uuid4()),
            'projectId': project_id,
            'type': 'project.create',
            'expectedVersions': [],
            'payload': {'name': 'Studio Test Film'},
        },
    )
    assert create_res.status_code == 200, create_res.text
    open_res = client.post(
        f'/api/creation/projects/{project_id}/open',
        headers=_headers(session_id),
    )
    assert open_res.status_code == 200, open_res.text

    # Generate a real 2-scene test MP4 on external folder and reference it (#473)
    video_file = tmp_path / 'two_scene_demo.mp4'
    _make_two_scene_video(video_file)

    ref_res = client.post(
        f'/api/creation/projects/{project_id}/assets/reference',
        headers=_headers(session_id),
        json={'path': str(video_file), 'name': 'two_scene_demo.mp4', 'expectedKind': 'video'},
    )
    assert ref_res.status_code == 200, ref_res.text
    asset_id = ref_res.json()['asset']['id']

    # 1. Probe
    probe_res = client.post(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/probe',
        headers=_headers(session_id),
    )
    assert probe_res.status_code == 200, probe_res.text
    probe = probe_res.json()
    assert probe['width'] == 320
    assert probe['height'] == 180
    assert probe['durationSec'] >= 1.8

    # 2. Intelligent scene breakdown
    scene_res = client.post(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/extract-frames',
        headers=_headers(session_id),
        json={'mode': 'scene', 'threshold': 0.25, 'maxFrames': 6},
    )
    assert scene_res.status_code == 200, scene_res.text
    frames = scene_res.json()['frames']
    assert len(frames) >= 2
    assert frames[0]['src'].startswith(f'/api/creation/projects/{project_id}/assets/')

    # 3. Exact tail-frame extraction
    tail_res = client.post(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/extract-frames',
        headers=_headers(session_id),
        json={'mode': 'last_frame'},
    )
    assert tail_res.status_code == 200, tail_res.text
    assert len(tail_res.json()['frames']) == 1
    assert tail_res.json()['frames'][0]['label'] == 'tail-frame'

    # 4. Zero-cost local FFmpeg 9:16 vertical reframe
    op_res = client.post(
        f'/api/creation/projects/{project_id}/assets/{asset_id}/local-video-op',
        headers=_headers(session_id),
        json={'op': 'reframe_9x16'},
    )
    assert op_res.status_code == 200, op_res.text
    op_body = op_res.json()
    assert op_body['probe']['width'] == 720
    assert op_body['probe']['height'] == 1280

    # 5. NLE Round-Trip Exports (FCPXML + SRT + Pitch Deck HTML)
    shots = [
        {
            'title': 'Shot 01 · Harbor Opening',
            'camera': 'FPV Drone Dive · 24mm',
            'prompt': 'Neon rain harbor wide shot',
            'durationSec': 4.0,
            'voiceover': 'Rain falls over the quiet harbor.',
            'assetId': asset_id,
        },
        {
            'title': 'Shot 02 · Close-Up Reveal',
            'camera': 'Dolly In · 85mm',
            'prompt': 'Protagonist looks up at lighthouse',
            'durationSec': 5.0,
            'voiceover': 'It has been three years.',
        },
    ]

    xml_res = client.post(
        f'/api/creation/projects/{project_id}/export/nle',
        headers=_headers(session_id),
        json={'format': 'fcpxml', 'title': 'Harbor Cut', 'fps': 24, 'shots': shots},
    )
    assert xml_res.status_code == 200, xml_res.text
    xml_data = xml_res.json()
    assert xml_data['filename'].endswith('.xml')
    root = ET.fromstring(xml_data['content'])
    assert root.tag == 'xmeml'
    clip_items = root.findall('.//clipitem')
    assert len(clip_items) == 2
    assert 'two_scene_demo.mp4' in xml_data['content']

    srt_res = client.post(
        f'/api/creation/projects/{project_id}/export/nle',
        headers=_headers(session_id),
        json={'format': 'srt', 'title': 'Harbor Cut', 'shots': shots},
    )
    assert srt_res.status_code == 200
    srt_text = srt_res.json()['content']
    assert '00:00:00,000 --> 00:00:04,000' in srt_text
    assert '00:00:04,000 --> 00:00:09,000' in srt_text

    deck_res = client.post(
        f'/api/creation/projects/{project_id}/export/nle',
        headers=_headers(session_id),
        json={
            'format': 'pitch_deck',
            'title': 'Harbor Cut',
            'styleLabel': 'Cyberpunk Neon',
            'aspectRatio': '16:9',
            'bible': [{'kind': 'Character', 'name': 'Lin', 'description': 'Raincoat courier', 'voice': 'Warm Alto'}],
            'shots': shots,
        },
    )
    assert deck_res.status_code == 200
    deck_html = deck_res.json()['content']
    assert 'Harbor Cut' in deck_html
    assert 'Production Bible' in deck_html
    assert 'Shot 01' in deck_html
