/** Client API for Issue #473: Import media by reference (zero-copy local bindings). */
import { json, request } from "./api.ts";

export type ReferenceAvailability = "online" | "offline" | "changed";

export interface ReferenceMediaAsset {
  assetId: string;
  name: string;
  kind: "image" | "video" | "audio" | "text" | "document";
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourcePath: string;
  availability: ReferenceAvailability;
  storageMode: "reference";
}

export interface ReferenceImportReceipt {
  asset: {
    id: string;
    name: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    fingerprint: string;
    revision: number;
  };
  storageMode: "reference";
  sourcePath: string;
  availability: ReferenceAvailability;
}

export async function listReferenceAssets(
  projectId: string,
): Promise<ReferenceMediaAsset[]> {
  const payload = await request<{ references: ReferenceMediaAsset[] }>(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/references`,
  );
  return payload.references ?? [];
}

export async function importReferenceAsset(
  projectId: string,
  path: string,
  name?: string,
): Promise<ReferenceImportReceipt> {
  return await request<ReferenceImportReceipt>(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/reference`,
    json("POST", { path, ...(name ? { name } : {}) }),
  );
}

export async function relinkReferenceAsset(
  projectId: string,
  assetId: string,
  path: string,
): Promise<{
  assetId: string;
  sourcePath: string;
  availability: ReferenceAvailability;
}> {
  return await request(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/relink`,
    json("POST", { path }),
  );
}

export async function consolidateReferenceAsset(
  projectId: string,
  assetId: string,
): Promise<{ assetId: string; storageMode: "managed" }> {
  return await request(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/consolidate`,
    json("POST", {}),
  );
}

export async function resolveLocalAssetPath(
  projectId: string,
  assetId: string,
): Promise<{
  assetId: string;
  name: string;
  kind: string;
  path: string;
  storageMode: "managed" | "reference";
  sizeBytes: number;
}> {
  return await request(
    `/creation/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/local-path`,
  );
}
