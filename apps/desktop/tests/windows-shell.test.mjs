import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeBounds, readState, writeState } from '../src/window-state.mjs';
import {
  allowRendererPermission, jumpList, parseDeepLink, recentProjects, shouldNotify, taskbarProgress, trayMenu,
} from '../src/windows-native.mjs';
import { compareVersions, decideUpdate, parseLatestYaml, UpdateManager, verifyFileSha512 } from '../src/updater.mjs';
import {
  decodeImagePayload, readNativeClipboard, validateMediaFilePath, windowsFileClipboardArgs,
} from '../src/clipboard.mjs';
import { buildDiagnosticsSummary, redactSecrets } from '../src/diagnostics.mjs';
import { diagnoseCommand } from '../src/command.mjs';
import { messages, format } from '../src/locale.mjs';
import { ownedURL } from '../src/host.mjs';

test('Window state restores valid multi-monitor bounds and rescues off-screen windows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'od-winstate-'));
  const file = join(dir, 'state.json');
  try {
    writeState(file, { bounds: { x: 100, y: 120, width: 1280, height: 800 }, maximized: true });
    const loaded = readState(file);
    assert.equal(loaded.maximized, true);
    assert.equal(loaded.bounds.width, 1280);

    const displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
    assert.deepEqual(sanitizeBounds(loaded.bounds, displays), { x: 100, y: 120, width: 1280, height: 800 });

    // Disconnected second monitor -> re-centered on primary monitor
    const rescued = sanitizeBounds({ x: 3200, y: 100, width: 1440, height: 900 }, displays);
    assert.equal(rescued.x, 240);
    assert.equal(rescued.y, 90);
    assert.equal(rescued.width, 1440);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows Jump List, Tray, Taskbar progress, Toast gating, Deep links and Permissions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'od-native-'));
  try {
    const p1 = join(workspace, 'projects', 'proj-alpha');
    await mkdir(p1, { recursive: true });
    await writeFile(join(p1, 'project.json'), JSON.stringify({ name: 'Cyberpunk Short' }));

    const recent = recentProjects(workspace);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].name, 'Cyberpunk Short');

    const jl = jumpList({ workspace, text: messages['zh-CN'], execPath: 'C:\\OpenDirector\\OpenDirector.exe' });
    assert.equal(jl.length, 2);
    assert.equal(jl[0].items[0].title, 'Cyberpunk Short');
    assert.match(jl[0].items[0].args, /^opendirector:\/\/project\/proj-alpha$/);

    assert.deepEqual(taskbarProgress(0.45, 'normal'), { value: 0.45, options: { mode: 'normal' } });
    assert.deepEqual(taskbarProgress(undefined, 'indeterminate'), { value: 2, options: { mode: 'indeterminate' } });
    assert.deepEqual(taskbarProgress(null), { clear: true });

    assert.equal(shouldNotify({ focused: true, minimized: false, hidden: false }), false);
    assert.equal(shouldNotify({ focused: false, minimized: false, hidden: false }), true);
    assert.equal(shouldNotify({ focused: true, minimized: true, hidden: false }), true);

    assert.deepEqual(parseDeepLink('opendirector://new'), { kind: 'new' });
    assert.deepEqual(parseDeepLink('opendirector://project/abc-123'), { kind: 'project', id: 'abc-123' });
    assert.deepEqual(parseDeepLink('opendirector://templates'), { kind: 'templates' });
    assert.equal(parseDeepLink('https://evil.test/new'), null);

    // Scoped permission allowlist (PR #458 + Issue #474)
    assert.equal(allowRendererPermission({ permission: 'clipboard-sanitized-write', originUrl: 'opendirector://app/', isOwnedUrl: ownedURL }), true);
    assert.equal(allowRendererPermission({ permission: 'clipboard-read', originUrl: 'opendirector://app/', isOwnedUrl: ownedURL }), true);
    assert.equal(allowRendererPermission({ permission: 'geolocation', originUrl: 'opendirector://app/', isOwnedUrl: ownedURL }), false);
    assert.equal(allowRendererPermission({ permission: 'clipboard-read', originUrl: 'https://evil.test/', isOwnedUrl: ownedURL }), false);

    const tray = trayMenu({ text: messages['en-US'], minimizeToTray: true, handlers: {} });
    assert.ok(tray.some(i => i.type === 'checkbox' && i.checked === true));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('D5 Auto-Updater parses latest.yml, compares versions, checks busy state, and verifies SHA-512', async () => {
  const payload = Buffer.from('fake-installer-binary-bytes');
  const expectedSha512 = createHash('sha512').update(payload).digest('base64');
  const yaml = [
    'version: 0.3.0',
    'files:',
    '  - url: OpenDirector-v0.3.0-win-x64-unsigned.exe',
    `    sha512: ${expectedSha512}`,
    `    size: ${payload.length}`,
    'path: OpenDirector-v0.3.0-win-x64-unsigned.exe',
  ].join('\n');

  const parsed = parseLatestYaml(yaml);
  assert.equal(parsed.version, '0.3.0');
  assert.equal(parsed.sha512, expectedSha512);
  assert.equal(compareVersions('0.3.0', '0.2.0'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0-desktop.1'), 1);
  assert.equal(decideUpdate({ current: '0.2.0', latest: parsed }).action, 'update');
  assert.equal(decideUpdate({ current: '0.3.0', latest: parsed }).action, 'none');

  const tmp = await mkdtemp(join(tmpdir(), 'od-upd-'));
  try {
    const file = join(tmp, 'sample.exe');
    await writeFile(file, payload);
    assert.equal((await verifyFileSha512(file, expectedSha512)).ok, true);
    assert.equal((await verifyFileSha512(file, 'deadbeef')).ok, false);

    // Busy deferral test
    let quitCalled = false;
    let spawnedArgs = null;
    const manager = new UpdateManager({
      current: '0.2.0',
      feedUrl: 'https://example.test/releases/latest.yml',
      fetchImpl: async url => {
        if (url.endsWith('latest.yml')) return new Response(yaml, { status: 200 });
        return new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } });
      },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      app: { quit: () => { quitCalled = true; } },
      tmp,
      localeText: (k, p) => format(messages['en-US'][k], p),
      isBusy: async () => true,
      spawnImpl: (_cmd, args) => { spawnedArgs = args; return { unref() {} }; },
    });
    const busyResult = await manager.check({ interactive: true });
    assert.equal(busyResult.action, 'deferred-busy');
    assert.equal(quitCalled, false);

    // Idle install with verified SHA-512
    manager.isBusy = async () => false;
    const installResult = await manager.check({ interactive: true });
    assert.equal(installResult.action, 'installing');
    assert.deepEqual(spawnedArgs, ['/S', '--updated']);
    assert.equal(quitCalled, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Issue #474 Native Clipboard validates images, file paths, PowerShell args, and reads back', async () => {
  const bytes = decodeImagePayload('data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64'));
  assert.equal(bytes.length, 4);
  assert.throws(() => decodeImagePayload(''), /clipboard_empty_image/);

  const root = await mkdtemp(join(tmpdir(), 'od-clip-'));
  try {
    const vid = join(root, 'clip.mp4');
    await writeFile(vid, 'mp4data');
    assert.equal(validateMediaFilePath(vid, [root]), vid);
    assert.throws(() => validateMediaFilePath(join(root, 'bad.exe'), [root]), /clipboard_unsupported_extension/);
    assert.throws(() => validateMediaFilePath('/etc/passwd', [root]), /clipboard_unsupported_extension/);

    const psArgs = windowsFileClipboardArgs("C:\\Users\\Director's Cut\\clip.mp4");
    assert.ok(psArgs.includes('-STA'));
    assert.ok(psArgs.at(-1).includes("Director''s Cut"));

    const readImg = readNativeClipboard({
      readImage: () => ({ isEmpty: () => false, toPNG: () => Buffer.from('PNG') }),
      readText: () => '',
    });
    assert.equal(readImg.kind, 'image');
    assert.match(readImg.dataUrl, /^data:image\/png;base64,/);

    const readTxt = readNativeClipboard({
      readImage: () => ({ isEmpty: () => true }),
      readText: () => '镜头一\n镜头二',
    });
    assert.deepEqual(readTxt, { kind: 'text', text: '镜头一\n镜头二' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Diagnostics summary redacts secrets and CLI diagnostics detects PATH shadowing', () => {
  const clean = redactSecrets('X-OpenDirector-Desktop: 0123456789abcdef0123456789abcdef sk-secret123456789');
  assert.doesNotMatch(clean, /0123456789abcdef/);
  assert.doesNotMatch(clean, /sk-secret/);

  const summary = buildDiagnosticsSummary({
    appVersion: '0.2.0',
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.22631',
    versions: { electron: '45.3.3', chrome: '136.0', node: '22.0' },
    runtime: { python: '3.11.9', ffmpeg: '7.1' },
    uptimeSeconds: 42,
    workspace: 'C:\\Users\\me\\AppData\\Roaming\\OpenDirector\\workspace',
  });
  assert.match(summary, /OpenDirector Windows Desktop 0\.2\.0/);
  assert.match(summary, /Runtime ffmpeg: 7\.1/);

  const diag = diagnoseCommand({
    destination: 'C:\\Users\\me\\.local\\bin\\opendirector.cmd',
    envPath: 'C:\\Miniconda3\\Scripts;C:\\Windows\\System32',
    platform: 'win32',
    exists: p => p.includes('Miniconda3'),
  });
  assert.equal(diag.inPath, false);
  assert.match(diag.shadowedBy, /Miniconda3/);
  assert.ok(diag.verifyCommands.includes('(Get-Command opendirector).Source'));
});
