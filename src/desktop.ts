/** Desktop lifecycle signals; business commands stay on the shared API. */
export type DesktopTaskProgressMode =
  | "none"
  | "normal"
  | "indeterminate"
  | "error"
  | "paused";

export interface DesktopClipboardReadResult {
  formats: string[];
  hasImage: boolean;
  imageDataUrl: string | null;
  text: string;
}

export interface DesktopUpdateResult {
  supported: boolean;
  status: string;
  currentVersion?: string;
  latestVersion?: string | null;
  releaseUrl?: string | null;
  error?: string | null;
}

export interface DesktopBridge {
  platform?: string;
  registerSession(id: string): void;
  setLocale(locale: "zh-CN" | "en-US"): void;
  showMore?(): void;
  setExporting(active: boolean): void;
  setTaskProgress?(value: number, mode?: DesktopTaskProgressMode): void;
  notify?(title: string, body: string): void;
  reportActivity?(state: { busy?: boolean; label?: string }): void;
  openProjectWindow?(projectId: string): Promise<boolean>;
  checkForUpdates?(): Promise<DesktopUpdateResult>;
  copyDiagnostics?(): Promise<{ ok: boolean; bytes: number }>;
  clipboardWriteText?(text: string): Promise<boolean>;
  clipboardWriteImage?(dataUrl: string): Promise<boolean>;
  clipboardWriteFile?(filePath: string): Promise<boolean>;
  clipboardRead?(): Promise<DesktopClipboardReadResult>;
  pickReferenceFiles?(): Promise<{ canceled: boolean; paths: string[] }>;
  onOpenTarget?(callback: (target: { kind: string; value: string }) => void): () => void;
}

declare global {
  interface Window { opendirectorDesktop?: DesktopBridge }
}

let exportsInProgress = 0;
export function desktopExportStarted(): () => void {
  exportsInProgress += 1;
  globalThis.window?.opendirectorDesktop?.setExporting(true);
  globalThis.window?.opendirectorDesktop?.setTaskProgress?.(0.02, "normal");
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    exportsInProgress -= 1;
    const stillActive = exportsInProgress > 0;
    globalThis.window?.opendirectorDesktop?.setExporting(stillActive);
    if (!stillActive) {
      globalThis.window?.opendirectorDesktop?.setTaskProgress?.(-1, "none");
    }
  };
}

export function desktopTaskProgress(value: number, mode: DesktopTaskProgressMode = "normal"): void {
  globalThis.window?.opendirectorDesktop?.setTaskProgress?.(value, mode);
}

export function desktopNotify(title: string, body: string): void {
  globalThis.window?.opendirectorDesktop?.notify?.(title, body);
}

export function desktopOpenProjectWindow(projectId: string): Promise<boolean> | null {
  const fn = globalThis.window?.opendirectorDesktop?.openProjectWindow;
  return fn ? fn(projectId) : null;
}
