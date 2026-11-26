"""Per-turn Agent Round Review & One-Click Undo Ledger (OpenCode-class harness)."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from opendirector.application.creation_history import UNDOABLE
from opendirector.domain.creation.commands import parse_command
from opendirector.domain.projects import ProjectError
from opendirector.infrastructure.creation_projects import durable_json
from opendirector.infrastructure.local_projects import child, read_json

LEDGER_FILENAME = 'round-ledger.json'


def _item_summary(item) -> dict[str, Any]:
    return {
        'id': str(item.id),
        'kind': str(getattr(item, 'kind', 'item')),
        'title': str(getattr(item, 'title', '') or getattr(item, 'kind', '')),
        'revision': int(getattr(item, 'revision', 1)),
        'visible': bool(getattr(item, 'visible', True)),
    }


def capture_round_baseline(snapshot) -> dict[str, Any]:
    return {
        'eventCursor': int(snapshot.eventCursor),
        'items': {str(item.id): _item_summary(item) for item in snapshot.canvasItems},
        'assets': {str(asset.id): {'id': str(asset.id), 'kind': asset.kind, 'name': asset.name}
                   for asset in snapshot.assets},
    }


def _ledger_path(directory: Path) -> Path:
    folder = child(directory, 'agent-runs')
    folder.mkdir(exist_ok=True)
    return child(folder, LEDGER_FILENAME)


def _load_ledger(directory: Path) -> dict[str, dict[str, Any]]:
    path = _ledger_path(directory)
    if not path.is_file():
        return {}
    try:
        raw = read_json(path)
        return raw if isinstance(raw, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_ledger(directory: Path, ledger: dict[str, dict[str, Any]]) -> None:
    durable_json(_ledger_path(directory), ledger)


def finalize_round_record(
    directory: Path,
    *,
    turn_id: UUID | str,
    mode: str,
    baseline: dict[str, Any],
    after_snapshot,
    history_entries: list[dict[str, Any]],
    duration_ms: int = 0,
    tool_calls: int = 0,
    output_chars: int = 0,
) -> dict[str, Any]:
    """Compute exact diff for an Agent turn and persist its undo ledger entry."""
    before_cursor = int(baseline['eventCursor'])
    before_items: dict[str, dict[str, Any]] = baseline['items']
    before_assets: dict[str, dict[str, Any]] = baseline['assets']
    after_items = {str(item.id): _item_summary(item) for item in after_snapshot.canvasItems}
    after_assets = {str(asset.id): {'id': str(asset.id), 'kind': asset.kind, 'name': asset.name}
                    for asset in after_snapshot.assets}

    added_items = [info for item_id, info in after_items.items()
                   if item_id not in before_items and info['visible']]
    removed_items = [info for item_id, info in before_items.items()
                     if before_items[item_id]['visible'] and (item_id not in after_items or not after_items[item_id]['visible'])]
    updated_items = [info for item_id, info in after_items.items()
                     if item_id in before_items and before_items[item_id]['visible'] and info['visible']
                     and info['revision'] != before_items[item_id]['revision']]
    added_assets = [info for asset_id, info in after_assets.items() if asset_id not in before_assets]

    # Collect reversible commands committed during this turn (newest first for LIFO undo).
    command_ids: list[str] = []
    for entry in history_entries:
        cursor = int(entry.get('cursor', 0))
        if cursor <= before_cursor:
            continue
        if entry.get('type') in UNDOABLE:
            command_ids.append(str(entry['commandId']))

    total_changes = len(added_items) + len(updated_items) + len(removed_items)
    # Transparent lightweight cost estimate (text tokens + tool calls) for #481 budget awareness.
    est_tokens = max(1, (output_chars // 4) + tool_calls * 220)
    estimated_cost_usd = round(est_tokens * 0.000003, 4)
    record = {
        'turnId': str(turn_id),
        'mode': mode,
        'beforeCursor': before_cursor,
        'afterCursor': int(after_snapshot.eventCursor),
        'addedItems': added_items,
        'updatedItems': updated_items,
        'removedItems': removed_items,
        'addedAssets': added_assets,
        'commandIds': command_ids,
        'totalChanges': total_changes,
        'durationMs': max(0, int(duration_ms)),
        'toolCalls': max(0, int(tool_calls)),
        'estimatedCostUsd': estimated_cost_usd,
        'canUndo': bool(command_ids) and mode != 'plan',
        'undone': False,
        'recordedAt': datetime.now(timezone.utc).isoformat(),
    }
    ledger = _load_ledger(directory)
    ledger[str(turn_id)] = record
    _save_ledger(directory, ledger)
    return record


def read_round_review(directory: Path, turn_id: UUID | str) -> dict[str, Any]:
    ledger = _load_ledger(directory)
    record = ledger.get(str(turn_id))
    if record is None:
        raise ProjectError('未找到该轮次的变更审阅记录。', 404, code='not_found')
    return dict(record)


def _expected_versions(snapshot) -> list[dict[str, Any]]:
    versions = []
    for obj_type, items in (
        ('canvas_item', snapshot.canvasItems),
        ('generation_spec', snapshot.generationSpecs),
        ('reference', snapshot.references),
        ('editor_document', snapshot.editorDocuments),
    ):
        for item in items:
            versions.append({'objectType': obj_type, 'id': str(item.id), 'revision': int(item.revision)})
    return versions


def undo_round(
    projects,
    directory: Path,
    project_id: UUID,
    turn_id: UUID | str,
    *,
    session: str | None = None,
) -> dict[str, Any]:
    """Undo every reversible command committed during an Agent round in reverse order."""
    ledger = _load_ledger(directory)
    record = ledger.get(str(turn_id))
    if record is None:
        raise ProjectError('未找到该轮次的变更审阅记录。', 404, code='not_found')
    if record.get('undone'):
        return {'turnId': str(turn_id), 'undone': True, 'alreadyUndone': True, 'revertedCommands': 0}
    command_ids = list(record.get('commandIds') or [])
    if not command_ids:
        raise ProjectError('该轮次没有可撤销的画布修改。', 409, code='nothing_to_undo')

    reverted = 0
    for target_cmd_id in command_ids:
        snap = projects.snapshot(project_id)
        cmd = parse_command({
            'commandId': str(uuid4()),
            'projectId': str(project_id),
            'type': 'history.undo',
            'expectedVersions': _expected_versions(snap),
            'payload': {'targetCommandId': target_cmd_id},
        })
        receipt = projects.execute(cmd, session=session, source='ui')
        if receipt.status == 'rejected':
            message = receipt.issue.message if receipt.issue else '撤销该轮修改失败。'
            raise ProjectError(message, 409)
        reverted += 1

    record['undone'] = True
    record['canUndo'] = False
    record['undoneAt'] = datetime.now(timezone.utc).isoformat()
    ledger[str(turn_id)] = record
    _save_ledger(directory, ledger)
    return {
        'turnId': str(turn_id),
        'undone': True,
        'alreadyUndone': False,
        'revertedCommands': reverted,
        'review': dict(record),
    }
