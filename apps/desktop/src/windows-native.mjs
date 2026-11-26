/**
 * Windows native shell helpers: Jump Lists, System Tray, Taskbar progress,
 * Toast notification gating, Deep Links, and Windows permission policy.
 * Pure functions keep behavior unit-testable without a live Windows desktop.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Read recent projects from workspace storage, ordered by latest modification. */
export function recentProjects(workspace, limit = 8) {
  try {
    const root = join(workspace, 'projects');
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const dir = join(root, entry.name);
        let mtime = 0;
        let title = entry.name;
        try {
          mtime = statSync(dir).mtimeMs;
          const metaPath = join(dir, 'project.json');
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          if (typeof meta?.name === 'string' && meta.name.trim()) title = meta.name.trim();
        } catch {
          // Fall back to directory ID when project.json is absent or unreadable.
        }
        return { id: entry.name, name: title, path: dir, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Build Electron Windows Jump List structure (tasks + recent projects). */
export function jumpList({ workspace, text, execPath = process.execPath, deepLinkBase = 'opendirector://' }) {
  const recent = recentProjects(workspace);
  const categories = [];
  if (recent.length > 0) {
    categories.push({
      name: text.recentProjects,
      items: recent.map(project => ({
        type: 'task',
        title: project.name,
        description: project.path,
        program: execPath,
        args: `${deepLinkBase}project/${encodeURIComponent(project.id)}`,
        iconPath: execPath,
        iconIndex: 0,
      })),
    });
  }
  categories.push({
    type: 'tasks',
    items: [
      { type: 'task', title: text.jumpNew, description: text.jumpNew, program: execPath, args: `${deepLinkBase}new`, iconPath: execPath, iconIndex: 0 },
      { type: 'task', title: text.jumpData, description: text.jumpData, program: execPath, args: '--open-data', iconPath: execPath, iconIndex: 0 },
      { type: 'task', title: text.jumpLogs, description: text.jumpLogs, program: execPath, args: '--open-logs', iconPath: execPath, iconIndex: 0 },
    ],
  });
  return categories;
}

/** Map normalized progress [0..1] and mode to Electron BrowserWindow.setProgressBar args. */
export function taskbarProgress(value, mode = 'normal') {
  if (mode === 'indeterminate') return { value: 2, options: { mode: 'indeterminate' } };
  if (value === null || value === undefined) return { clear: true };
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  if (mode === 'error') return { value: clamped, options: { mode: 'error' } };
  if (mode === 'paused') return { value: clamped, options: { mode: 'paused' } };
  return { value: clamped, options: { mode: 'normal' } };
}

/** Notify only when the window is unfocused, minimized, or hidden in the tray. */
export function shouldNotify({ focused, minimized, hidden }) {
  return !focused || Boolean(minimized) || Boolean(hidden);
}

/** Build System Tray context menu template. */
export function trayMenu({ text, minimizeToTray, handlers }) {
  return [
    { label: text.trayShow, click: handlers.show },
    { label: text.trayNew, click: handlers.newProject },
    { type: 'separator' },
    { label: text.trayOpenData, click: handlers.openData },
    { label: text.checkUpdates, click: handlers.checkUpdates },
    { type: 'separator' },
    { label: text.trayMinimize, type: 'checkbox', checked: Boolean(minimizeToTray), click: handlers.toggleMinimize },
    { type: 'separator' },
    { label: text.trayQuit, click: handlers.quit },
  ];
}

/** Parse opendirector:// deep links into structured renderer navigation targets. */
export function parseDeepLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'opendirector:') return null;
    const hostPart = url.hostname ? [url.hostname] : [];
    const pathParts = url.pathname.split('/').filter(Boolean);
    const [kind, ...rest] = [...hostPart, ...pathParts];
    if (kind === 'new') return { kind: 'new' };
    if (kind === 'project' && rest[0]) return { kind: 'project', id: decodeURIComponent(rest[0]) };
    if (kind === 'templates') return { kind: 'templates' };
    return { kind: 'home' };
  } catch {
    return null;
  }
}

/**
 * Explicit renderer permission allowlist (PR #458 + Issue #474):
 * Only the owned opendirector://app origin may access clipboard permissions.
 */
const ALLOWED_RENDERER_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
]);

export function allowRendererPermission({ permission, originUrl, isOwnedUrl }) {
  if (!originUrl || typeof isOwnedUrl !== 'function') return false;
  try {
    if (!isOwnedUrl(originUrl)) return false;
  } catch {
    return false;
  }
  return ALLOWED_RENDERER_PERMISSIONS.has(permission);
}
