import { readFileSync, writeFileSync } from 'node:fs';

export const DEFAULT_BOUNDS = { width: 1440, height: 920 };
export const MIN_WIDTH = 960;
export const MIN_HEIGHT = 640;

export function readState(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return { bounds: { ...DEFAULT_BOUNDS }, maximized: false };
    return {
      bounds: raw.bounds && typeof raw.bounds === 'object' ? raw.bounds : { ...DEFAULT_BOUNDS },
      maximized: Boolean(raw.maximized),
    };
  } catch {
    return { bounds: { ...DEFAULT_BOUNDS }, maximized: false };
  }
}

export function writeState(file, state) {
  try {
    writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch {
    // Non-fatal: window state persistence must never interrupt app usage.
  }
}

/**
 * Clamp and validate persisted window bounds against currently connected displays
 * so windows never open off-screen after undocking or DPI changes.
 */
export function sanitizeBounds(bounds, displays) {
  const width = Math.max(MIN_WIDTH, Number(bounds?.width) || DEFAULT_BOUNDS.width);
  const height = Math.max(MIN_HEIGHT, Number(bounds?.height) || DEFAULT_BOUNDS.height);
  if (!Array.isArray(displays) || displays.length === 0) {
    return { width, height };
  }
  const hasPosition = Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y);
  if (hasPosition) {
    const x = Number(bounds.x);
    const y = Number(bounds.y);
    const visible = displays.some(({ bounds: d }) => {
      const overlapX = Math.min(x + width, d.x + d.width) - Math.max(x, d.x);
      const overlapY = Math.min(y + height, d.y + d.height) - Math.max(y, d.y);
      return overlapX >= 120 && overlapY >= 80;
    });
    if (visible) return { x, y, width, height };
  }
  const primary = displays[0].bounds;
  const clampedW = Math.min(width, Math.max(MIN_WIDTH, primary.width));
  const clampedH = Math.min(height, Math.max(MIN_HEIGHT, primary.height));
  return {
    x: primary.x + Math.max(0, Math.round((primary.width - clampedW) / 2)),
    y: primary.y + Math.max(0, Math.round((primary.height - clampedH) / 2)),
    width: clampedW,
    height: clampedH,
  };
}

export function attachWindowState(win, file) {
  let timer = null;
  let lastNormal = win.getBounds();
  const persist = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    if (!maximized && !win.isMinimized()) lastNormal = win.getBounds();
    writeState(file, { bounds: lastNormal, maximized });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, 250);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', persist);
  win.on('unmaximize', persist);
  win.on('close', () => {
    clearTimeout(timer);
    persist();
  });
}
