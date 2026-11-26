/**
 * Bidirectional native clipboard helpers for Windows Desktop (Issue #474).
 *
 * Supports:
 *  - Plain Unicode text preserving line breaks
 *  - Images via nativeImage -> OS clipboard (paste directly into WeChat / PowerPoint / Email / Codex)
 *  - Video/media files via Windows Set-Clipboard -Path (CF_HDROP file drop list, no renderer buffering)
 *  - Reading OS clipboard images & text back into the canvas
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif',
  '.mp4', '.mov', '.webm', '.mkv', '.avi',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
]);

/** Decode a data:image/...;base64,... URL or raw base64 string into a Buffer. */
export function decodeImagePayload(payload, maxBytes = 64 * 1024 * 1024) {
  if (typeof payload !== 'string' || !payload.trim()) {
    throw new Error('clipboard_empty_image');
  }
  const stripped = payload.startsWith('data:')
    ? payload.slice(payload.indexOf(',') + 1)
    : payload;
  const bytes = Buffer.from(stripped, 'base64');
  if (!bytes.length) throw new Error('clipboard_invalid_image');
  if (bytes.length > maxBytes) throw new Error('clipboard_image_too_large');
  return bytes;
}

/** Validate a local media file path before writing a Windows file-drop clipboard entry. */
export function validateMediaFilePath(filePath, allowedRoots = []) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('clipboard_invalid_path');
  }
  const normalized = resolve(filePath);
  const ext = extname(normalized).toLowerCase();
  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
    throw new Error('clipboard_unsupported_extension');
  }
  if (allowedRoots.length > 0) {
    const inside = allowedRoots.some(root => {
      const resolvedRoot = resolve(root);
      return normalized === resolvedRoot || normalized.startsWith(resolvedRoot + '/') || normalized.startsWith(resolvedRoot + '\\');
    });
    if (!inside) throw new Error('clipboard_path_outside_workspace');
  }
  if (!existsSync(normalized)) {
    throw new Error('clipboard_file_missing');
  }
  return normalized;
}

/** Build the PowerShell command arguments to put a file on the Windows clipboard (CF_HDROP). */
export function windowsFileClipboardArgs(filePath) {
  // Pass path via environment variable or single-quoted escaped literal to avoid injection.
  const escaped = filePath.replace(/'/g, "''");
  return [
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-Command',
    `Set-Clipboard -LiteralPath '${escaped}'`,
  ];
}

export async function writeWindowsFileToClipboard(filePath, { execImpl = execFileAsync } = {}) {
  const args = windowsFileClipboardArgs(filePath);
  await execImpl('powershell.exe', args, { windowsHide: true, timeout: 10_000 });
  return { ok: true, kind: 'file', path: filePath };
}

/** Read available content (image PNG data URL or plain text) from Electron clipboard. */
export function readNativeClipboard(clipboardApi) {
  const image = clipboardApi.readImage?.();
  if (image && !image.isEmpty()) {
    const png = image.toPNG();
    if (png?.length) {
      return {
        kind: 'image',
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      };
    }
  }
  const text = clipboardApi.readText?.() ?? '';
  if (text) {
    return { kind: 'text', text };
  }
  return { kind: 'empty' };
}
