const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opendirectorDesktop', {
  // Core lifecycle bridge (upstream PR #397 contract)
  registerSession: id => ipcRenderer.send('desktop:session', id),
  setLocale: locale => ipcRenderer.send('desktop:locale', locale),
  ...(['darwin', 'win32'].includes(process.platform) ? { showMore: () => ipcRenderer.send('desktop:more') } : {}),
  setExporting: active => ipcRenderer.send('desktop:exporting', active),

  // Windows flagship native capabilities
  platform: process.platform,
  setTaskProgress: (value, mode) => ipcRenderer.send('desktop:task-progress', { value, mode }),
  notify: payload => ipcRenderer.send('desktop:notify', payload),
  reportActivity: active => ipcRenderer.send('desktop:activity', active),
  openProjectWindow: projectId => ipcRenderer.invoke('desktop:open-window', projectId),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  copyDiagnostics: () => ipcRenderer.invoke('desktop:copy-diagnostics'),

  // Issue #474: Bidirectional native clipboard
  clipboardWriteText: text => ipcRenderer.invoke('desktop:clipboard-write-text', text),
  clipboardWriteImage: dataUrl => ipcRenderer.invoke('desktop:clipboard-write-image', dataUrl),
  clipboardWriteFile: filePath => ipcRenderer.invoke('desktop:clipboard-write-file', filePath),
  clipboardRead: () => ipcRenderer.invoke('desktop:clipboard-read'),

  // Issue #473: Native local file picker for zero-copy reference import
  pickReferenceFiles: options => ipcRenderer.invoke('desktop:pick-reference-files', options),

  // Deep link / Jump List / file-association target listener
  onOpenTarget: handler => {
    if (typeof handler !== 'function') return () => {};
    const wrapped = (_event, target) => handler(target);
    ipcRenderer.on('desktop:open-target', wrapped);
    return () => ipcRenderer.removeListener('desktop:open-target', wrapped);
  },
});

function markDesktop() {
  document.documentElement.dataset.desktopPlatform = process.platform;
  if (['darwin', 'win32'].includes(process.platform)) document.documentElement.dataset.desktopChrome = '';
  const theme = () => ipcRenderer.send('desktop:theme', document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  theme();
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
if (document.documentElement) markDesktop();
else window.addEventListener('DOMContentLoaded', markDesktop, { once: true });

ipcRenderer.on('desktop:fullscreen', (_event, fullscreen) => {
  if (fullscreen) document.documentElement.dataset.desktopFullscreen = 'true';
  else delete document.documentElement.dataset.desktopFullscreen;
});
