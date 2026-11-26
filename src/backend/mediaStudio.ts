import { request } from "./api.ts";

export interface MediaProbeResult {
  assetId: string;
  name: string;
  kind: string;
  storageMode: string;
  width: number;
  height: number;
  fps: number;
  isVfr: boolean;
  durationSec: number;
  videoCodec: string;
  audioCodec: string | null;
  hasAudio: boolean;
  bitrateKbps: number;
  fileSizeBytes: number;
}

export interface ExtractedFrameItem {
  index: number;
  timestampSec: number;
  durationSec: number;
  label: string;
  assetId: string;
  name: string;
  kind: "image";
  src: string;
}

export interface ExtractFramesResponse {
  sourceAssetId: string;
  sourceName: string;
  mode: string;
  frames: ExtractedFrameItem[];
}

export type LocalVideoOpKind =
  | "reframe_9x16"
  | "reframe_16x9"
  | "cfr_24"
  | "film_grain"
  | "reverse";

export interface LocalVideoOpResponse {
  sourceAssetId: string;
  op: LocalVideoOpKind;
  assetId: string;
  name: string;
  kind: "video";
  src: string;
  probe: Omit<MediaProbeResult, "assetId" | "name" | "kind" | "storageMode">;
}

export interface NleShotInput {
  title: string;
  camera?: string;
  prompt?: string;
  durationSec: number;
  voiceover?: string;
  assetId?: string;
  localPath?: string;
}

export interface NleBibleInput {
  kind: string;
  name: string;
  description: string;
  voice?: string;
}

export interface NleExportResponse {
  format: "fcpxml" | "srt" | "pitch_deck";
  filename: string;
  mimeType: string;
  content: string;
}

export function probeAssetMedia(
  projectId: string,
  assetId: string,
  session?: string,
): Promise<MediaProbeResult> {
  return request<MediaProbeResult>(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/probe`,
    {
      method: "POST",
      headers: session ? { "X-OpenDirector-Session": session } : undefined,
    },
  );
}

export function extractAssetFrames(
  projectId: string,
  assetId: string,
  options: { mode: "scene" | "last_frame" | "keyframes"; threshold?: number; maxFrames?: number },
  session?: string,
): Promise<ExtractFramesResponse> {
  return request<ExtractFramesResponse>(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/extract-frames`,
    {
      method: "POST",
      headers: session ? { "X-OpenDirector-Session": session } : undefined,
      body: JSON.stringify(options),
    },
  );
}

export function runLocalVideoOp(
  projectId: string,
  assetId: string,
  op: LocalVideoOpKind,
  session?: string,
): Promise<LocalVideoOpResponse> {
  return request<LocalVideoOpResponse>(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/local-video-op`,
    {
      method: "POST",
      headers: session ? { "X-OpenDirector-Session": session } : undefined,
      body: JSON.stringify({ op }),
    },
  );
}

export function exportNlePackage(
  projectId: string,
  payload: {
    format: "fcpxml" | "srt" | "pitch_deck";
    title: string;
    fps?: number;
    width?: number;
    height?: number;
    styleLabel?: string;
    aspectRatio?: string;
    bible?: NleBibleInput[];
    shots: NleShotInput[];
  },
): Promise<NleExportResponse> {
  return request<NleExportResponse>(
    `/creation/projects/${encodeURIComponent(projectId)}/export/nle`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
