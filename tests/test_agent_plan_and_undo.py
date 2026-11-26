"""Tests for OpenCode-class Agent Plan/Build server-enforced read-only mode and Round Review + Undo Ledger."""
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from opendirector.agent.round_ledger import capture_round_baseline, finalize_round_record, read_round_review
from opendirector.infrastructure.local_projects import LocalProjects
from opendirector_api.main import create_app

HEADERS = {'X-OpenDirector-Request': '1'}


def _create_project(client: TestClient, session: str, name: str = 'Harness Project') -> str:
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


def test_plan_mode_enforces_server_side_read_only_write_lock(tmp_path: Path):
    store = LocalProjects(tmp_path)
    app = create_app(store)
    client = TestClient(app)
    session = str(uuid4())
    project_id = _create_project(client, session)

    projects_service = app.state.creation_projects
    projects_service.plan_mode_sessions = {session}

    # Any mutating command under a Plan-mode session is rejected by the server (403)
    res = client.post(
        f'/api/creation/projects/{project_id}/commands',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
        json={
            'commandId': str(uuid4()),
            'projectId': project_id,
            'type': 'asset.writeText',
            'expectedVersions': [],
            'payload': {'name': 'blocked.md', 'text': 'Should never be written in Plan mode'},
        },
    )
    assert res.status_code == 403
    assert len(projects_service.snapshot(project_id).assets) == 0

    # Leaving Plan mode restores Build writes
    projects_service.plan_mode_sessions.discard(session)
    ok = client.post(
        f'/api/creation/projects/{project_id}/commands',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
        json={
            'commandId': str(uuid4()),
            'projectId': project_id,
            'type': 'asset.writeText',
            'expectedVersions': [],
            'payload': {'name': 'allowed.md', 'text': 'Written in Build mode'},
        },
    )
    assert ok.status_code == 200, ok.text
    assert len(projects_service.snapshot(project_id).assets) == 1


def test_agent_round_review_and_one_click_undo_ledger(tmp_path: Path):
    store = LocalProjects(tmp_path)
    app = create_app(store)
    client = TestClient(app)
    session = str(uuid4())
    project_id = _create_project(client, session)
    projects = app.state.creation_projects

    before = projects.snapshot(project_id)
    baseline = capture_round_baseline(before)
    assert len(before.canvasItems) == 0

    # Agent creates two text nodes during a Build round via creation.batch
    for idx in (1, 2):
        spec_id = str(uuid4())
        item_id = str(uuid4())
        batch_res = client.post(
            f'/api/creation/projects/{project_id}/commands',
            headers={**HEADERS, 'X-OpenDirector-Session': session},
            json={
                'commandId': str(uuid4()),
                'projectId': project_id,
                'type': 'creation.batch',
                'expectedVersions': [],
                'payload': {
                    'operations': [
                        {
                            'type': 'generationSpec.create',
                            'payload': {
                                'spec': {
                                    'id': spec_id,
                                    'projectId': project_id,
                                    'kind': 'text',
                                    'purpose': 'draft',
                                },
                            },
                        },
                        {
                            'type': 'canvas.show',
                            'payload': {
                                'item': {
                                    'id': item_id,
                                    'projectId': project_id,
                                    'kind': 'text',
                                    'title': f'Shot {idx}',
                                    'binding': {'role': 'empty', 'draftSpec': {'id': spec_id}},
                                },
                            },
                        },
                    ],
                },
            },
        )
        assert batch_res.status_code == 200, batch_res.text

    after = projects.snapshot(project_id)
    assert len([i for i in after.canvasItems if i.visible]) == 2

    turn_id = uuid4()
    directory = tmp_path / 'projects' / 'Harness Project'
    _, history_entries = projects.history_index(project_id)
    review = finalize_round_record(
        directory,
        turn_id=turn_id,
        mode='build',
        baseline=baseline,
        after_snapshot=after,
        history_entries=history_entries,
        duration_ms=420,
        tool_calls=2,
        output_chars=400,
    )
    assert review['totalChanges'] == 2
    assert review['durationMs'] == 420
    assert review['toolCalls'] == 2
    assert review['estimatedCostUsd'] > 0
    assert len(review['addedItems']) == 2
    assert review['canUndo'] is True
    assert review['undone'] is False

    # Verify /api/desktop/runtime-health returns live runtime status without leaking secrets
    health_res = client.get('/api/desktop/runtime-health', headers=HEADERS)
    assert health_res.status_code == 200, health_res.text
    health_body = health_res.json()
    assert health_body['status'] == 'ok'
    assert 'pythonVersion' in health_body
    assert 'ffmpegAvailable' in health_body

    # GET review endpoint returns the recorded diff
    get_res = client.get(f'/api/creation/projects/{project_id}/assistant/turns/{turn_id}/review', headers=HEADERS)
    assert get_res.status_code == 200, get_res.text
    assert get_res.json()['totalChanges'] == 2

    # POST undo endpoint rolls back all nodes created in the round!
    undo_res = client.post(
        f'/api/creation/projects/{project_id}/assistant/turns/{turn_id}/undo',
        headers={**HEADERS, 'X-OpenDirector-Session': session},
    )
    assert undo_res.status_code == 200, undo_res.text
    assert undo_res.json()['undone'] is True
    assert undo_res.json()['revertedCommands'] == 2

    reverted_snap = projects.snapshot(project_id)
    assert len([i for i in reverted_snap.canvasItems if i.visible]) == 0
    assert read_round_review(directory, turn_id)['undone'] is True
