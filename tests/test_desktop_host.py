import asyncio
import json
import os
import subprocess
import sys

from fastapi.testclient import TestClient
import pytest

from opendirector_api.desktop import DesktopAuthentication, Initialize
from opendirector_api.main import create_app
from opendirector.infrastructure.local_projects import LocalProjects


pytestmark = pytest.mark.cpu


def test_desktop_auth_protects_api_and_static_without_changing_browser_mode(tmp_path):
    app = create_app(LocalProjects(tmp_path))
    app.add_middleware(DesktopAuthentication, token='a' * 64)
    with TestClient(app) as client:
        for path in ['/', '/api/health', '/api/creation/projects']:
            assert client.get(path, headers={'X-OpenDirector-Request': '1'}).status_code == 403
        assert client.get('/api/health', headers=[(b'x-opendirector-desktop', b'\xff')]).status_code == 403
        for language, expected in [('en-US', 'Reopen'), ('zh-CN', '重新打开')]:
            assert expected in client.get('/api/health', headers={'Accept-Language': language}).json()['detail']
        headers = {'X-OpenDirector-Desktop': 'a' * 64, 'X-OpenDirector-Request': '1'}
        assert client.get('/api/health', headers=headers).json() == {'status': 'ok'}
        assert client.get('/api/creation/projects', headers=headers).status_code == 200
    with TestClient(create_app(LocalProjects(tmp_path))) as client:
        assert client.get('/api/health', headers={'X-OpenDirector-Request': '1'}).status_code == 200


def test_desktop_initialize_rejects_wrong_version_and_short_credentials():
    for value in [dict(type='initialize', version=2, token='a' * 64), dict(type='initialize', version=1, token='short')]:
        with pytest.raises(ValueError):
            Initialize.model_validate(value)


def test_desktop_rejects_bad_parent_handshake_without_starting(tmp_path):
    process = subprocess.run([sys.executable, '-m', 'opendirector_api.desktop'],
        input='{"type":"initialize","version":1,"token":"short"}\n',
        capture_output=True, text=True, timeout=20, env={**os.environ, 'OPENDIRECTOR_ROOT': str(tmp_path)})
    assert process.returncode == 1
    assert json.loads(process.stdout)['type'] == 'fatal'
    assert not list(tmp_path.iterdir())


def test_desktop_auth_rejects_websocket_without_accepting_it():
    events = []

    async def application(scope, receive, send):
        pytest.fail('Unauthenticated WebSocket reached the application')

    async def receive():
        return {'type': 'websocket.connect'}

    async def send(event):
        events.append(event)

    asyncio.run(DesktopAuthentication(application, token='a' * 64)(
        {'type': 'websocket', 'headers': []}, receive, send))
    assert events == [{'type': 'websocket.close', 'code': 1008}]


def test_desktop_dev_host_handshake_serves_embedded_ui_and_clean_shutdown(tmp_path):
    """Verify the exact local-source Electron Desktop Host handshake (`OPENDIRECTOR_DESKTOP_DEV=1`)."""
    import urllib.error
    import urllib.request
    from pathlib import Path
    from opendirector.installation import web_root

    if not (web_root() / 'index.html').is_file():
        pytest.skip('dist/index.html not built yet')

    token = 'b' * 64
    env = {
        **os.environ,
        'OPENDIRECTOR_ROOT': str(tmp_path),
        'OPENDIRECTOR_DESKTOP_DEV': '1',
        'PATH': f"{Path.home() / 'bin'}:{os.environ.get('PATH', '')}",
    }
    proc = subprocess.Popen(
        [sys.executable, '-B', '-m', 'opendirector_api.desktop'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    try:
        assert proc.stdin and proc.stdout
        proc.stdin.write(json.dumps({'type': 'initialize', 'version': 1, 'token': token}) + '\n')
        proc.stdin.flush()

        first = json.loads(proc.stdout.readline())
        assert first == {'type': 'starting', 'version': 1}
        ready = json.loads(proc.stdout.readline())
        assert ready['type'] == 'ready', ready
        base_url = ready['url']
        assert base_url.startswith('http://127.0.0.1:')
        assert 'python' in ready['runtime']

        # Unauthenticated request must be blocked with 403
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(f'{base_url}/')
        assert exc.value.code == 403

        # Authenticated desktop protocol request serves embedded UI & runtime health
        req_ui = urllib.request.Request(f'{base_url}/', headers={'X-OpenDirector-Desktop': token})
        with urllib.request.urlopen(req_ui, timeout=5) as resp:
            assert resp.status == 200
            html = resp.read().decode('utf-8')
            assert '<!doctype html>' in html.lower() or '<html' in html.lower()

        req_health = urllib.request.Request(
            f'{base_url}/api/desktop/runtime-health',
            headers={'X-OpenDirector-Desktop': token, 'X-OpenDirector-Request': '1'},
        )
        with urllib.request.urlopen(req_health, timeout=5) as resp:
            assert resp.status == 200
            health = json.loads(resp.read().decode('utf-8'))
            assert health['status'] == 'ok'
            assert health['ffmpegAvailable'] is True

        # Clean graceful shutdown via desktop control channel
        proc.stdin.write(json.dumps({'type': 'shutdown', 'requestId': 1}) + '\n')
        proc.stdin.close()
        shutdown = json.loads(proc.stdout.readline())
        assert shutdown == {'type': 'shutdown-complete'}
        assert proc.wait(timeout=15) == 0
    finally:
        if proc.poll() is None:
            proc.kill()

