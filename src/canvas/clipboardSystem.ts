/** Bidirectional system clipboard export/import (Issue #474): text, image (PNG/DIB), Windows CF_HDROP media file, and screenshot paste. */
import { fetchMediaSource } from "../backend/creationClient.ts";
import { parseAssetSource } from "../backend/assetSource.ts";
import { resolveLocalAssetPath } from "../backend/referenceMedia.ts";
import type { CanvasNode } from "./model.ts";

export type SystemClipboardOutcome =
  | { status: "copied"; kind: "text" | "image" | "file" }
  | { status: "fallback"; kind: "video" | "audio" }
  | { status: "skipped" };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return blob;
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((out) => resolve(out ?? blob), "image/png"),
    );
  } finally {
    bitmap.close();
  }
}

export function dataUrlToPngFile(dataUrl: string, filename = "clipboard-screenshot.png"): File | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

export async function readDesktopClipboardScreenshot(): Promise<File | null> {
  const reader = globalThis.window?.opendirectorDesktop?.clipboardRead;
  if (!reader) return null;
  try {
    const result = await reader();
    if (result?.hasImage && result.imageDataUrl) {
      return dataUrlToPngFile(result.imageDataUrl, `clipboard-${Date.now()}.png`);
    }
  } catch {
    return null;
  }
  return null;
}

export async function copyNodeToSystemClipboard(
  nodes: CanvasNode[],
  projectId?: string,
): Promise<SystemClipboardOutcome> {
  if (nodes.length !== 1) return { status: "skipped" };
  const node = nodes[0];
  const desktop = globalThis.window?.opendirectorDesktop;

  // 1. Plain text node -> system clipboard preserving line breaks
  if (node.type === "text") {
    const text = (node.data.text ?? node.data.prompt ?? "").trimEnd();
    if (!text) return { status: "skipped" };
    if (desktop?.clipboardWriteText) {
      const ok = await desktop.clipboardWriteText(text).catch(() => false);
      if (ok) return { status: "copied", kind: "text" };
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return { status: "copied", kind: "text" };
      } catch {
        return { status: "skipped" };
      }
    }
    return { status: "skipped" };
  }

  // 2. Image node -> PNG/DIB bitmap on desktop or Web ClipboardItem
  if (node.type === "image" && node.data.src) {
    try {
      const response = await fetchMediaSource(node.data.src);
      if (!response.ok) return { status: "skipped" };
      const pngBlob = await blobToPng(await response.blob());
      if (desktop?.clipboardWriteImage) {
        const dataUrl = await blobToDataUrl(pngBlob);
        const ok = await desktop.clipboardWriteImage(dataUrl).catch(() => false);
        if (ok) return { status: "copied", kind: "image" };
      }
      if (
        typeof ClipboardItem !== "undefined" &&
        navigator.clipboard?.write
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": pngBlob }),
        ]);
        return { status: "copied", kind: "image" };
      }
    } catch {
      return { status: "skipped" };
    }
    return { status: "skipped" };
  }

  // 3. Video / Audio nodes -> Windows native CF_HDROP file clipboard on desktop, explicit fallback on Web
  if ((node.type === "video" || node.type === "audio") && node.data.src) {
    if (desktop?.clipboardWriteFile && projectId) {
      const parsed = parseAssetSource(node.data.src);
      const assetId =
        parsed?.assetId ??
        (typeof node.data.assetId === "string" ? node.data.assetId : undefined);
      if (assetId) {
        try {
          const resolved = await resolveLocalAssetPath(projectId, assetId);
          const ok = await desktop.clipboardWriteFile(resolved.path).catch(() => false);
          if (ok) return { status: "copied", kind: "file" };
        } catch {
          /* fall back to explicit guidance */
        }
      }
    }
    return { status: "fallback", kind: node.type };
  }

  return { status: "skipped" };
}
