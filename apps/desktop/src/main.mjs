import { z } from 'zod';
import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme,
  net, Notification, powerSaveBlocker, protocol, screen, session, shell, Tray,
} from 'electron';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, release } from 'node:os';
import { Host, ownedURL, proxyRequest } from './host.mjs';
import { messages, localeFor, format } from './locale.mjs';
import { registerCommand, commandPath, diagnoseCommand } from './command.mjs';
import { attachWindowState, readState, sanitizeBounds } from './window-state.mjs';
import {
  allowRendererPermission, jumpList, parseDeepLink, shouldNotify, taskbarProgress, trayMenu,
} from './windows-native.mjs';
import { UpdateManager } from './updater.mjs';
import {
  decodeImagePayload, readNativeClipboard, validateMediaFilePath, writeWindowsFileToClipboard,
} from './clipboard.mjs';
import { buildDiagnosticsSummary } from './diagnostics.mjs';

app.setName('OpenDirector');
if (process.platform === 'win32') app.setAppUserModelId('org.opendirector.desktop');

const desktopChrome = ['darwin', 'win32'].includes(process.platform);
const captionHeight = 48;
const here = dirname(fileURLToPath(import.meta.url));
const runtime = app.isPackaged ? join(process.resourcesPath, 'runtime') : join(here, '..', 'runtime');
const isolated = process.env.OPENDIRECTOR_DESKTOP_DATA;
if (isolated) app.setPath('userData', isolated);

protocol.registerSchemesAsPrivileged([{ scheme: 'opendirector', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true,
} }]);

let host;
let window;
const childWindows = new Set();
let tray = null;
let exporting = false;
let blockerId = null;
let activity = { agents: 0, generations: 0, tools: 0 };
let quitting = false;
let quitPending = false;
let pendingTarget = null;
let locale = localeFor(app.getLocale());
const startedAt = Date.now();
const text = () => messages[locale];
const t = (key, params) => format(text()[key] ?? key, params);

const userData = app.getPath('userData');
const logs = join(userData, 'logs');
const workspace = join(userData, 'workspace');
const stateFile = join(userData, 'window-state.json');
const prefsFile = join(userData, 'desktop-prefs.json');
mkdirSync(logs, { recursive: true });
mkdirSync(workspace, { recursive: true });
const logFile = join(logs, 'desktop.log');
const log = createWriteStream(logFile, { flags: 'a', mode: 0o600 });

let prefs = { minimizeToTray: true };
try { prefs = { ...prefs, ...JSON.parse(readFileSync(prefsFile, 'utf8')) }; } catch {}
const savePrefs = () => {
  try { writeFileSync(prefsFile, JSON.stringify(prefs, null, 2), { mode: 0o600 }); } catch {}
};

try { locale = localeFor(readFileSync(join(userData, 'locale'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') log.write(`Locale read failed: ${error.message}\n`); }

const updateFeedUrl = process.env.OPENDIRECTOR_UPDATE_FEED_URL
  || 'https://github.com/hanyingHY/Work-For-OpenDirector/releases/latest/download/latest.yml';

const updater = new UpdateManager({
  current: app.getVersion(),
  feedUrl: updateFeedUrl,
  dialog,
  app,
  log,
  localeText: (key, params) => t(key, params),
  isBusy: hasActiveWork,
  onProgress: (value, mode) => applyTaskbarProgress(value, mode),
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    showMainWindow();
    handleLaunchTargets(argv.slice(1));
  });
  app.whenReady().then(start).catch(fatal);
}

function showMainWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function handleLaunchTargets(args) {
  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    if (arg === '--open-data') { void shell.openPath(workspace); continue; }
    if (arg === '--open-logs') { void shell.openPath(logs); continue; }
    if (arg === '--updated') { log.write('update: relaunched after update\n'); continue; }
    if (arg.startsWith('opendirector://')) {
      const target = parseDeepLink(arg);
      if (target) deliverTarget(target);
      continue;
    }
    if (arg.toLowerCase().endsWith('.odcanvas') && existsSync(arg)) {
      deliverTarget({ kind: 'import', path: arg });
    }
  }
}

function deliverTarget(target) {
  if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) {
    pendingTarget = target;
    return;
  }
  showMainWindow();
  window.webContents.send('desktop:open-target', target);
}

function trusted(event) {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  const owned = senderWin === window || (senderWin && childWindows.has(senderWin));
  return Boolean(owned && event.senderFrame === event.sender.mainFrame && ownedURL(event.senderFrame.url));
}

function applyTaskbarProgress(value, mode) {
  if (!window || window.isDestroyed()) return;
  const mapped = taskbarProgress(value, mode);
  if (mapped.clear) window.setProgressBar(-1);
  else window.setProgressBar(mapped.value, mapped.options);
}

function windowsCaption() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { height: captionHeight, color: dark ? '#141414' : '#f7f8fa', symbolColor: dark ? '#eceef2' : '#30343c' };
}

function refreshJumpList() {
  if (process.platform !== 'win32') return;
  try {
    app.setJumpList(jumpList({ workspace, text: text(), execPath: process.execPath }));
  } catch (error) {
    log.write(`JumpList refresh failed: ${error.message}\n`);
  }
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu({
    text: text(),
    minimizeToTray: prefs.minimizeToTray,
    handlers: {
      show: showMainWindow,
      newProject: () => deliverTarget({ kind: 'new' }),
      openData: () => { void shell.openPath(workspace); },
      checkUpdates: () => { void updater.check({ interactive: true }); },
      toggleMinimize: () => {
        prefs.minimizeToTray = !prefs.minimizeToTray;
        savePrefs();
        buildTrayMenu();
      },
      quit: () => app.quit(),
    },
  })));
}

function resolveAppIcon() {
  const candidates = [
    join(here, '..', 'assets', 'tray.png'),
    join(here, '..', '..', '..', 'src', 'assets', 'open_director_logo.png'),
  ];
  return candidates.find(p => existsSync(p));
}

function createTray() {
  if (process.platform !== 'win32' || tray || process.argv.includes('--smoke')) return;
  const iconPath = resolveAppIcon();
  if (!iconPath) return;
  try {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('OpenDirector');
    tray.on('double-click', showMainWindow);
    buildTrayMenu();
  } catch (error) {
    log.write(`Tray init failed: ${error.message}\n`);
  }
}

function desktopActions() {
  return [
    { label: text().newProject, click: () => deliverTarget({ kind: 'new' }) },
    { type: 'separator' },
    { label: text().command, click: manageCommand },
    { label: text().data, click: () => { void shell.openPath(workspace); } },
    { label: text().logs, click: () => { void shell.openPath(logs); } },
    { label: text().diagnostics, click: copyDiagnosticsDialog },
    { type: 'separator' },
    { label: text().checkUpdates, click: () => { void updater.check({ interactive: true }); } },
  ];
}

function collectDiagnostics() {
  return buildDiagnosticsSummary({
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    versions: process.versions,
    runtime: host?.runtime ?? {},
    uptimeSeconds: (Date.now() - startedAt) / 1000,
    workspace,
    logFile,
  });
}

async function copyDiagnosticsDialog() {
  const summary = collectDiagnostics();
  clipboard.writeText(summary);
  await dialog.showMessageBox(window, {
    message: text().diagnosticsCopied,
    detail: summary,
    buttons: [text().close],
  });
}

function menu() {
  const editing = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map(role => ({ role, label: text()[role] }));
  const view = [
    { role: 'togglefullscreen', label: text().fullscreen },
    { role: 'toggleDevTools', label: text().devtools },
  ];
  const quit = { label: text().quit, accelerator: 'CmdOrCtrl+Q', click: () => app.quit() };
  const shortcuts = [...editing, ...view, quit].map(item => ({ ...item, visible: false, acceleratorWorksWhenHidden: true }));
  if (process.platform === 'win32') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(shortcuts));
    return;
  }
  const about = { role: 'about', label: text().app };
  Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'darwin' ? [
    { label: text().app, submenu: [about, quit, ...shortcuts.slice(0, -1)] },
  ] : [
    { label: text().app, submenu: [about, ...desktopActions(), quit] },
    { label: text().edit, submenu: editing },
    { label: text().view, submenu: view },
  ]));
}

async function manageCommand() {
  const destination = commandPath(homedir());
  const diag = diagnoseCommand({ destination });
  const detailParts = [destination];
  if (!diag.inPath) detailParts.push('', t('commandPathMissing', { dir: diag.destDir, hint: diag.addToPathHint }));
  if (diag.shadowedBy) detailParts.push('', t('commandShadowed', { other: diag.shadowedBy, dir: diag.destDir }));

  const { response } = await dialog.showMessageBox(window, {
    message: text().command,
    detail: detailParts.join('\n'),
    buttons: [text().install, text().remove, text().cancel],
    cancelId: 2,
  });
  if (response === 2) return;
  if (response === 1) {
    await dialog.showMessageBox(window, { message: text().commandRemoveHelp, detail: destination });
    return;
  }
  try {
    const launcher = join(runtime, 'bin', process.platform === 'win32' ? 'opendirector.cmd' : 'opendirector');
    const result = await registerCommand({ destination, launcher });
    const postDiag = diagnoseCommand({ destination });
    const postDetail = [
      destination,
      '',
      t('commandVerifyHint', { commands: postDiag.verifyCommands.join('\n') }),
    ];
    if (!postDiag.inPath) postDetail.push('', t('commandPathMissing', { dir: postDiag.destDir, hint: postDiag.addToPathHint }));
    if (postDiag.shadowedBy) postDetail.push('', t('commandShadowed', { other: postDiag.shadowedBy, dir: postDiag.destDir }));
    await dialog.showMessageBox(window, {
      message: text()[result === 'installed' ? 'commandDone' : 'commandAlreadyInstalled'],
      detail: postDetail.join('\n'),
    });
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'error',
      message: text().failed,
      detail: error.message === 'command_collision' ? [text().collision, destination].join('\n') : error.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Validated IPC handlers
// ---------------------------------------------------------------------------
ipcMain.on('desktop:locale', (event, value) => {
  if (!trusted(event) || !['en-US', 'zh-CN'].includes(value)) return;
  locale = value;
  writeFileSync(join(userData, 'locale'), value, { mode: 0o600 });
  menu();
  refreshJumpList();
  buildTrayMenu();
});

ipcMain.on('desktop:theme', (event, value) => {
  if (trusted(event) && ['light', 'dark'].includes(value)) {
    nativeTheme.themeSource = value;
    if (process.platform === 'win32') {
      window?.setTitleBarOverlay?.(windowsCaption());
      for (const child of childWindows) if (!child.isDestroyed()) child.setTitleBarOverlay?.(windowsCaption());
    }
    applyBackdrop();
  }
});

ipcMain.on('desktop:session', (event, value) => {
  const parsed = z.uuid().safeParse(value);
  if (trusted(event) && parsed.success) host?.registerSession(parsed.data);
});

ipcMain.on('desktop:exporting', (event, value) => {
  if (!trusted(event) || typeof value !== 'boolean') return;
  exporting = value;
  if (value) {
    if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
      blockerId = powerSaveBlocker.start('prevent-display-sleep');
    }
    log.write(`${text().exportActive}\n`);
  } else {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
    applyTaskbarProgress(null, 'normal');
  }
});

ipcMain.on('desktop:activity', (event, value) => {
  if (!trusted(event) || typeof value !== 'object' || value === null) return;
  for (const key of ['agents', 'generations', 'tools']) {
    if (Number.isFinite(value[key]) && value[key] >= 0) activity[key] = value[key];
  }
  refreshJumpList();
});

ipcMain.on('desktop:task-progress', (event, payload) => {
  if (!trusted(event)) return;
  const { value, mode } = payload ?? {};
  const safeMode = ['normal', 'indeterminate', 'error', 'paused'].includes(mode) ? mode : 'normal';
  const safeValue = typeof value === 'number' ? value : value === null ? null : undefined;
  applyTaskbarProgress(safeValue, safeMode);
});

ipcMain.on('desktop:notify', (event, payload) => {
  if (!trusted(event) || !Notification.isSupported()) return;
  const focused = window?.isFocused() ?? false;
  const minimized = window?.isMinimized() ?? false;
  const hidden = !(window?.isVisible() ?? false);
  if (!shouldNotify({ focused, minimized, hidden })) return;
  const { title, body } = payload ?? {};
  if (typeof title !== 'string' || !title.trim()) return;
  const note = new Notification({
    title: title.slice(0, 200),
    body: typeof body === 'string' ? body.slice(0, 500) : '',
  });
  note.on('click', showMainWindow);
  note.show();
  if (process.platform === 'win32' && window && !window.isDestroyed()) {
    window.flashFrame(true);
  }
});

ipcMain.on('desktop:more', event => {
  if (trusted(event) && desktopChrome) Menu.buildFromTemplate(desktopActions()).popup({ window });
});

ipcMain.handle('desktop:check-updates', async event => {
  if (!trusted(event)) return { action: 'denied' };
  return updater.check({ interactive: true });
});

ipcMain.handle('desktop:copy-diagnostics', async event => {
  if (!trusted(event)) return { ok: false };
  const summary = collectDiagnostics();
  clipboard.writeText(summary);
  return { ok: true, summary };
});

ipcMain.handle('desktop:open-window', async (event, projectId) => {
  if (!trusted(event)) return { ok: false };
  const parsed = z.uuid().safeParse(projectId);
  if (!parsed.success) return { ok: false, error: 'invalid_project_id' };
  const ownedSession = session.fromPartition('persist:opendirector');
  const secondary = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'OpenDirector',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: windowsCaption(),
      backgroundMaterial: 'mica',
    } : {}),
    webPreferences: {
      session: ownedSession,
      preload: join(here, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (process.platform === 'win32') secondary.setMenuBarVisibility(false);
  childWindows.add(secondary);
  secondary.on('closed', () => childWindows.delete(secondary));
  secondary.webContents.on('will-navigate', (navEvent, url) => {
    if (!ownedURL(url)) navEvent.preventDefault();
  });
  await secondary.loadURL(`opendirector://app/?project=${encodeURIComponent(parsed.data)}`);
  return { ok: true };
});

// Issue #474: Native Clipboard IPC
ipcMain.handle('desktop:clipboard-write-text', (event, value) => {
  if (!trusted(event) || typeof value !== 'string') return { ok: false };
  clipboard.writeText(value);
  return { ok: true, kind: 'text' };
});

ipcMain.handle('desktop:clipboard-write-image', (event, dataUrl) => {
  if (!trusted(event)) return { ok: false };
  try {
    const buffer = decodeImagePayload(dataUrl);
    const img = nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) return { ok: false, error: 'clipboard_empty_image' };
    clipboard.writeImage(img);
    return { ok: true, kind: 'image' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('desktop:clipboard-write-file', async (event, filePath) => {
  if (!trusted(event)) return { ok: false };
  try {
    const safePath = validateMediaFilePath(filePath, [workspace]);
    if (process.platform === 'win32') {
      return await writeWindowsFileToClipboard(safePath);
    }
    clipboard.writeText(safePath);
    return { ok: true, kind: 'path', path: safePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('desktop:clipboard-read', event => {
  if (!trusted(event)) return { kind: 'empty' };
  return readNativeClipboard(clipboard);
});

// Issue #473: Native reference file picker (returns authorized local paths without copying)
ipcMain.handle('desktop:pick-reference-files', async (event, options = {}) => {
  if (!trusted(event)) return { canceled: true, files: [] };
  const result = await dialog.showOpenDialog(window, {
    title: text().pickReferenceTitle,
    properties: ['openFile', ...(options?.multiple === false ? [] : ['multiSelections'])],
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'wav', 'mp3', 'm4a', 'flac'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { canceled: true, files: [] };
  const files = result.filePaths.map(filePath => {
    let size = 0;
    try { size = statSync(filePath).size; } catch {}
    return { path: filePath, size };
  });
  return { canceled: false, files };
});

function resolveHostConfig() {
  const manifestPath = join(runtime, 'manifest.json');
  const pathSep = process.platform === 'win32' ? ';' : ':';
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.python !== 'string' || manifest.python.startsWith('/') || manifest.python.split(/[\\/]/).includes('..')) {
      throw new Error('Invalid runtime Python path');
    }
    if (manifest.version !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch) {
      throw new Error('Runtime platform does not match this application');
    }
    return {
      python: join(runtime, manifest.python),
      isolated: true,
      env: {
        ...process.env,
        OPENDIRECTOR_ROOT: workspace,
        PATH: join(runtime, 'bin') + pathSep + (process.env.PATH ?? ''),
      },
    };
  }

  if (app.isPackaged) {
    throw new Error('Packaged runtime manifest is missing.');
  }

  // Local source desktop run (no bundled runtime/ yet): use repo .venv + PYTHONPATH directly.
  const repoRoot = join(here, '..', '..', '..');
  const venvPython = process.platform === 'win32'
    ? join(repoRoot, '.venv', 'Scripts', 'python.exe')
    : join(repoRoot, '.venv', 'bin', 'python');
  const python = process.env.OPENDIRECTOR_PYTHON
    || (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));
  const sourcePaths = [
    join(repoRoot, 'packages', 'core', 'src'),
    join(repoRoot, 'apps', 'api', 'src'),
    ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : []),
  ].join(pathSep);
  const extraBins = [
    join(homedir(), 'bin'),
    join(repoRoot, '.toolchain', 'ffmpeg', 'bin'),
  ].filter(dir => existsSync(dir));

  log.write(`desktop-dev: starting local source host with python=${python}\n`);
  return {
    python,
    isolated: false,
    env: {
      ...process.env,
      OPENDIRECTOR_ROOT: workspace,
      OPENDIRECTOR_DESKTOP_DEV: '1',
      PYTHONPATH: sourcePaths,
      PATH: [...extraBins, process.env.PATH ?? ''].filter(Boolean).join(pathSep),
    },
  };
}

async function start() {
  menu();
  handleLaunchTargets(process.argv.slice(1));
  const hostConfig = resolveHostConfig();
  host = new Host({
    python: hostConfig.python,
    isolated: hostConfig.isolated,
    directory: workspace,
    log,
    env: hostConfig.env,
    onExit: () => { if (!quitting) void fatal(new Error(text().interrupted)); },
  });
  await host.ready;
  const ownedSession = session.fromPartition('persist:opendirector');
  ownedSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowRendererPermission({
      permission,
      originUrl: contents?.getURL?.() ?? '',
      isOwnedUrl: ownedURL,
    }));
  });
  let projectSubscription;
  ownedSession.protocol.handle('opendirector', request => proxyRequest(request, host, async (url, options) => {
    const pathname = new URL(url).pathname;
    if (options.method === 'GET' && /^\/api\/creation\/projects\/[^/]+\/subscribe$/.test(pathname)) {
      projectSubscription?.abort();
      projectSubscription = new AbortController();
      options.signal = AbortSignal.any([options.signal, projectSubscription.signal]);
    }
    const assetMedia = options.method === 'GET' &&
      /^\/api\/creation\/projects\/[^/]+\/assets\/[^/]+\/content$/.test(pathname);
    return options.duplex || assetMedia ? fetch(url, options) : net.fetch(url, options);
  }));
  ownedSession.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: text().save }));

  const restored = readState(stateFile);
  let initialBounds = { width: 1440, height: 960 };
  try {
    const displays = screen.getAllDisplays().map(d => ({ bounds: d.bounds }));
    initialBounds = sanitizeBounds(restored.bounds, displays);
  } catch {}

  const appIcon = resolveAppIcon();
  window = new BrowserWindow({
    ...initialBounds,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'OpenDirector',
    ...(appIcon ? { icon: appIcon } : {}),
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    } : {}),
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: windowsCaption(),
      backgroundMaterial: 'mica',
    } : {}),
    webPreferences: {
      session: ownedSession,
      preload: join(here, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (restored.maximized) window.maximize();
  attachWindowState(window, stateFile);

  if (process.platform === 'win32') window.setMenuBarVisibility(false);
  if (desktopChrome) {
    const fullscreen = value => window.webContents.send('desktop:fullscreen', value);
    window.on('enter-full-screen', () => fullscreen(true));
    window.on('leave-full-screen', () => fullscreen(false));
    window.on('focus', () => { if (process.platform === 'win32') window.flashFrame(false); });
    window.webContents.on('did-finish-load', () => {
      fullscreen(window.isFullScreen());
      if (pendingTarget) {
        const next = pendingTarget;
        pendingTarget = null;
        window.webContents.send('desktop:open-target', next);
      }
    });
    if (process.platform === 'darwin') {
      for (const event of ['minimize', 'hide', 'restore', 'show']) window.on(event, applyBackdrop);
    }
  }
  const traceURL = url => {
    const target = new URL(url);
    return ownedURL(url) && target.pathname === '/' && target.searchParams.has('traceProject');
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (traceURL(url)) {
      const trace = new BrowserWindow({
        parent: window,
        width: 1100,
        height: 760,
        webPreferences: {
          session: ownedSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      if (process.platform !== 'darwin') trace.removeMenu();
      trace.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      trace.webContents.on('will-navigate', (event, target) => {
        if (!traceURL(target)) event.preventDefault();
      });
      void trace.loadURL(url).catch(error => {
        log.write(`Trace window failed: ${error.message}\n`);
        if (!trace.isDestroyed()) trace.destroy();
      });
    } else if (new URL(url).protocol === 'https:') {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!ownedURL(url)) event.preventDefault(); });
  window.webContents.on('render-process-gone', (_event, { reason, exitCode }) => {
    exporting = false;
    log.write(`Renderer exited: reason=${reason} exitCode=${exitCode}\n`);
  });
  window.on('close', event => {
    if (!quitting && (prefs.minimizeToTray || process.platform === 'darwin')) {
      event.preventDefault();
      window.hide();
    }
  });
  app.on('activate', showMainWindow);
  await window.loadURL('opendirector://app/');
  window.show();
  createTray();
  refreshJumpList();

  if (process.argv.includes('--smoke')) {
    try {
      const { smokeWindow } = await import('../scripts/smoke-window.mjs');
      const result = await smokeWindow({ window, host, getLocale: () => locale });
      quitting = true;
      window.destroy();
      if (!(await host.stop())) throw new Error('Host exited without confirming session cleanup');
      log.write(`smoke ${JSON.stringify(result)}\n`);
      app.exit(0);
    } catch (error) {
      log.write('Desktop smoke test failed\n');
      console.error(error);
      quitting = true;
      window?.destroy();
      await host.stop();
      app.exit(1);
    }
    return;
  }

  // Schedule non-interactive update check shortly after launch.
  setTimeout(() => { if (!quitting) updater.check({ interactive: false }).catch(() => {}); }, 20_000);
}

function applyBackdrop() {
  if (process.platform !== 'darwin' || !window || window.isDestroyed()) return;
  if (window.isMinimized() || !window.isVisible()) {
    window.setVibrancy(null);
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#202022' : '#eeeef1');
  } else {
    window.setVibrancy('sidebar');
    window.setBackgroundColor('#00000000');
  }
}

async function hasActiveWork() {
  const state = await host?.inspect?.();
  if (exporting) return true;
  if (state === null) return activity.agents > 0 || activity.generations > 0 || activity.tools > 0;
  return Boolean(state && (state.agents || state.generations || state.tools));
}

async function fatal(error) {
  log.write(`Host failure: ${error.message}\n`);
  await host?.stop();
  if (process.argv.includes('--smoke')) { app.exit(1); return; }
  await dialog.showMessageBox({
    type: 'error',
    message: text().startup,
    detail: `${error.message}\n${logFile}`,
    buttons: [text().close],
  });
  quitting = true;
  app.quit();
}

app.on('window-all-closed', () => {});

app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void (async () => {
    try {
      const state = await host?.inspect();
      if (exporting || state === null || (state && (state.agents || state.generations || state.tools))) {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          message: text().running,
          buttons: [text().cancel, text().quit],
          defaultId: 0,
          cancelId: 0,
        });
        if (response !== 1) return;
      }
      quitting = true;
      if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
        powerSaveBlocker.stop(blockerId);
        blockerId = null;
      }
      for (const child of childWindows) if (!child.isDestroyed()) child.destroy();
      tray?.destroy();
      window?.destroy();
      await host?.stop();
      app.quit();
    } finally {
      quitPending = false;
    }
  })();
});
