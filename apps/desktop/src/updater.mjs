/**
 * D5 Automatic Update engine for Windows NSIS distribution (Issue #367).
 *
 * Features:
 *  - Parse electron-builder `latest.yml` feed (version, path, sha512, size)
 *  - Semantic version comparison (including prerelease tags like 0.1.6 vs 0.1.5-desktop.1)
 *  - Active-work guard before installing (warns & defers if export/Agent/generation runs)
 *  - SHA-512 integrity verification before executing the downloaded installer
 *  - Atomic download (.part -> final) with cancellation support and actionable bilingual dialogs
 *  - Preserves user projects and credentials via NSIS `/S --updated`
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function parseLatestYaml(text) {
  if (typeof text !== 'string') return { version: null, path: null, sha512: null, files: [] };
  const field = name => {
    const match = new RegExp(`^${name}:\\s*['"]?([^\\r\\n'"]+)`, 'm').exec(text);
    return match?.[1]?.trim() ?? null;
  };
  const version = field('version');
  const files = [];
  const block = /files:\s*\r?\n([\s\S]*?)(\r?\n\w|$)/.exec(text);
  if (block) {
    const chunks = block[1].split(/\r?\n(?=\s*-\s)/).filter(chunk => chunk.includes('url:'));
    for (const chunk of chunks) {
      const url = /url:\s*['"]?([^\s'"]+)/.exec(chunk)?.[1] ?? null;
      const sha512 = /sha512:\s*['"]?([^\s'"]+)/.exec(chunk)?.[1] ?? null;
      const size = /size:\s*['"]?(\d+)/.exec(chunk)?.[1] ?? null;
      if (url) files.push({ url, sha512, size: size ? Number(size) : null });
    }
  }
  const path = field('path') ?? files[0]?.url ?? null;
  const sha512 = field('sha512') ?? files.find(f => f.url === path)?.sha512 ?? files[0]?.sha512 ?? null;
  return { version, path, sha512, files };
}

export function compareVersions(a, b) {
  const split = v => {
    const [core, pre = ''] = String(v).replace(/^v/i, '').split('-', 2);
    return { parts: core.split('.').map(n => parseInt(n, 10) || 0), pre };
  };
  const va = split(a);
  const vb = split(b);
  for (let i = 0; i < Math.max(va.parts.length, vb.parts.length); i += 1) {
    const d = (va.parts[i] ?? 0) - (vb.parts[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (va.pre === vb.pre) return 0;
  if (!va.pre && vb.pre) return 1; // Release beats prerelease
  if (va.pre && !vb.pre) return -1;
  return va.pre.localeCompare(vb.pre, 'en', { numeric: true });
}

export function decideUpdate({ current, latest }) {
  if (!latest?.version || !latest?.path) return { action: 'none', reason: 'no-release' };
  const cmp = compareVersions(latest.version, current);
  if (cmp > 0) {
    return { action: 'update', version: latest.version, path: latest.path, sha512: latest.sha512 ?? null };
  }
  return { action: 'none', reason: 'up-to-date', version: latest.version };
}

/** Verify SHA-512 base64 digest (electron-builder format) or hex digest against a file. */
export async function verifyFileSha512(filePath, expected) {
  if (!expected) return { ok: true, skipped: true };
  const hash = createHash('sha512');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const actualBase64 = hash.digest('base64');
  const actualHex = Buffer.from(actualBase64, 'base64').toString('hex');
  const normalized = expected.trim();
  const ok = actualBase64 === normalized || actualHex.toLowerCase() === normalized.toLowerCase();
  return { ok, actualBase64, actualHex };
}

export class UpdateManager {
  constructor({
    current,
    feedUrl,
    fetchImpl = fetch,
    dialog,
    app,
    log,
    tmp = tmpdir(),
    localeText,
    isBusy = async () => false,
    onProgress = () => {},
    spawnImpl = spawn,
  }) {
    Object.assign(this, { current, feedUrl, fetchImpl, dialog, app, log, tmp, localeText, isBusy, onProgress, spawnImpl });
    this.activeAbort = null;
  }

  cancel() {
    this.activeAbort?.abort();
  }

  async check({ interactive = false } = {}) {
    let latest = null;
    try {
      const response = await this.fetchImpl(this.feedUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      latest = parseLatestYaml(await response.text());
    } catch (error) {
      this.log?.write(`update: feed check failed: ${error.message}\n`);
      if (interactive) {
        await this.dialog.showMessageBox({
          type: 'error',
          message: this.localeText('updateFailed'),
          detail: this.localeText('updateFailedDetail', { error: error.message }),
          buttons: ['OK'],
        });
      }
      return { action: 'error', error: error.message };
    }
    const decision = decideUpdate({ current: this.current, latest });
    if (decision.action !== 'update') {
      if (interactive) {
        await this.dialog.showMessageBox({
          message: this.localeText('updateNone'),
          detail: this.localeText('updateNoneDetail', { current: this.current }),
          buttons: ['OK'],
        });
      }
      return decision;
    }
    const { response: confirmed } = await this.dialog.showMessageBox({
      type: 'question',
      message: this.localeText('updateAvailable'),
      detail: this.localeText('updateAvailableDetail', { version: decision.version, current: this.current }),
      buttons: [this.localeText('updateDownload'), this.localeText('updateLater')],
      defaultId: 0,
      cancelId: 1,
    });
    if (confirmed !== 0) return { action: 'deferred', version: decision.version };
    return this.downloadAndInstall(decision);
  }

  async downloadAndInstall(decision) {
    if (await this.isBusy()) {
      const { response: proceed } = await this.dialog.showMessageBox({
        type: 'warning',
        message: this.localeText('updateBusyTitle'),
        detail: this.localeText('updateBusyDetail'),
        buttons: [this.localeText('updateLater'), this.localeText('updateInstallAnyway')],
        defaultId: 0,
        cancelId: 0,
      });
      if (proceed !== 1) return { action: 'deferred-busy', version: decision.version };
    }

    const installer = join(this.tmp, `OpenDirector-${decision.version}-setup.exe`);
    const abort = new AbortController();
    this.activeAbort = abort;
    try {
      const base = new URL(this.feedUrl).href.replace(/[^/]+$/, '');
      const downloadUrl = new URL(decision.path, base).href;
      this.onProgress(0, 'indeterminate');
      const response = await this.fetchImpl(downloadUrl, { signal: abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await streamToFile(response.body, installer, Number(response.headers?.get?.('content-length') || 0), this.onProgress);
      if (!existsSync(installer)) throw new Error('Installer missing after download');
      const verified = await verifyFileSha512(installer, decision.sha512);
      if (!verified.ok) {
        await rm(installer, { force: true });
        throw new Error('SHA-512 integrity check failed');
      }
      this.onProgress(null, 'normal');
      const child = this.spawnImpl(installer, ['/S', '--updated'], { detached: true, stdio: 'ignore' });
      child.unref?.();
      this.log?.write(`update: installer launched (${decision.version})\n`);
      this.app?.quit();
      return { action: 'installing', version: decision.version };
    } catch (error) {
      this.onProgress(null, 'normal');
      if (abort.signal.aborted) {
        this.log?.write('update: download cancelled by user\n');
        return { action: 'cancelled', version: decision.version };
      }
      this.log?.write(`update: install failed: ${error.message}\n`);
      await this.dialog.showMessageBox({
        type: 'error',
        message: this.localeText('updateFailed'),
        detail: this.localeText('updateFailedDetail', { error: error.message }),
        buttons: ['OK'],
      });
      return { action: 'error', error: error.message };
    } finally {
      this.activeAbort = null;
    }
  }
}

async function streamToFile(stream, path, totalBytes, onProgress) {
  const { Readable } = await import('node:stream');
  const temporary = path + '.part';
  const writer = createWriteStream(temporary);
  let downloaded = 0;
  const readable = Readable.fromWeb(stream);
  try {
    await new Promise((resolve, reject) => {
      readable.on('data', chunk => {
        downloaded += chunk.length;
        if (totalBytes > 0) onProgress(Math.min(1, downloaded / totalBytes), 'normal');
      });
      readable.on('error', reject);
      writer.on('error', reject);
      writer.on('finish', resolve);
      readable.pipe(writer);
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
