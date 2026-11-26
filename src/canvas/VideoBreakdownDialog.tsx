import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { MessageKey } from "../i18n/types.ts";
import { request } from "../backend/api.ts";
import {
  extractAssetFrames,
  probeAssetMedia,
  runLocalVideoOp,
  type ExtractedFrameItem,
  type LocalVideoOpKind,
  type LocalVideoOpResponse,
  type MediaProbeResult,
} from "../backend/mediaStudio.ts";

interface ProjectAssetOption {
  id: string;
  name: string;
  kind: string;
}

interface VideoBreakdownDialogProps {
  open: boolean;
  projectId: string;
  readOnly: boolean;
  onClose: () => void;
  onPlaceFrames: (sourceName: string, frames: ExtractedFrameItem[], mode: "scene" | "last_frame") => void;
  onPlaceVideo: (result: LocalVideoOpResponse) => void;
  onNotify: (msg: string) => void;
}

const VIDEO_OPS: readonly LocalVideoOpKind[] = [
  "reframe_9x16",
  "reframe_16x9",
  "cfr_24",
  "film_grain",
  "reverse",
];

export function VideoBreakdownDialog({
  open,
  projectId,
  readOnly,
  onClose,
  onPlaceFrames,
  onPlaceVideo,
  onNotify,
}: VideoBreakdownDialogProps) {
  const { t } = useI18n();
  const [videos, setVideos] = useState<ProjectAssetOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [probe, setProbe] = useState<MediaProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    setError(null);
    void request<ProjectAssetOption[]>(`/creation/projects/${encodeURIComponent(projectId)}/assets`)
      .then((list) => {
        const onlyVideos = (list || []).filter((a) => a.kind === "video");
        setVideos(onlyVideos);
        if (onlyVideos.length && !onlyVideos.some((v) => v.id === selectedId)) {
          setSelectedId(onlyVideos[0].id);
        }
      })
      .catch(() => setVideos([]));
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selected = videos.find((v) => v.id === selectedId) ?? videos[0];

  const handleProbe = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const info = await probeAssetMedia(projectId, selected.id);
      setProbe(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async (mode: "scene" | "last_frame") => {
    if (!selected || readOnly) return;
    setBusy(true);
    setError(null);
    try {
      const res = await extractAssetFrames(projectId, selected.id, {
        mode,
        threshold: 0.28,
        maxFrames: 6,
      });
      onPlaceFrames(selected.name, res.frames, mode);
      onNotify(
        mode === "last_frame"
          ? t("canvas.breakdown.tailDone")
          : t("canvas.breakdown.sceneDone", { count: res.frames.length }),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLocalOp = async (op: LocalVideoOpKind) => {
    if (!selected || readOnly) return;
    setBusy(true);
    setError(null);
    try {
      const res = await runLocalVideoOp(projectId, selected.id, op);
      onPlaceVideo(res);
      onNotify(t("canvas.breakdown.opDone"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.breakdown.title")}
      data-testid="video-breakdown-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal cw-breakdown-modal">
        <header className="cw-win-modal-header">
          <div>
            <h2>{t("canvas.breakdown.title")}</h2>
            <p>{t("canvas.breakdown.subtitle")}</p>
          </div>
          <button
            type="button"
            className="cw-win-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>

        <div className="cw-breakdown-body">
          {!videos.length ? (
            <p className="cw-reference-empty">{t("canvas.breakdown.noVideos")}</p>
          ) : (
            <>
              <div className="cw-studio-section">
                <label className="cw-studio-label" htmlFor="breakdown-video-select">
                  {t("canvas.breakdown.selectVideo")}
                </label>
                <div className="cw-breakdown-select-row">
                  <select
                    id="breakdown-video-select"
                    className="cw-studio-select"
                    value={selected?.id ?? ""}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setProbe(null);
                    }}
                  >
                    {videos.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="cw-win-btn is-secondary"
                    data-testid="breakdown-probe-btn"
                    disabled={busy}
                    onClick={() => void handleProbe()}
                  >
                    {t("canvas.breakdown.probeBtn")}
                  </button>
                </div>
              </div>

              {probe && (
                <div className="cw-probe-metrics" data-testid="breakdown-probe-card">
                  <span>{probe.width} × {probe.height}</span>
                  <span>{probe.fps} fps {probe.isVfr ? "(VFR)" : "(CFR)"}</span>
                  <span>{probe.durationSec.toFixed(2)}s</span>
                  <span>{probe.videoCodec}</span>
                  <span>{probe.hasAudio ? `Audio: ${probe.audioCodec}` : "No Audio"}</span>
                  <span>{probe.storageMode}</span>
                </div>
              )}

              <div className="cw-breakdown-primary-actions">
                <button
                  type="button"
                  className="cw-win-btn is-primary"
                  data-testid="breakdown-scene-btn"
                  disabled={busy || readOnly}
                  onClick={() => void handleExtract("scene")}
                >
                  {t("canvas.breakdown.sceneBtn")}
                </button>
                <button
                  type="button"
                  className="cw-win-btn is-secondary"
                  data-testid="breakdown-tail-btn"
                  disabled={busy || readOnly}
                  onClick={() => void handleExtract("last_frame")}
                >
                  {t("canvas.breakdown.tailBtn")}
                </button>
              </div>

              <div className="cw-studio-section">
                <div className="cw-studio-label">{t("canvas.breakdown.opsTitle")}</div>
                <div className="cw-studio-pill-row">
                  {VIDEO_OPS.map((op) => (
                    <button
                      key={op}
                      type="button"
                      data-testid={`breakdown-op-${op}`}
                      className="cw-studio-pill"
                      disabled={busy || readOnly}
                      onClick={() => void handleLocalOp(op)}
                    >
                      {t(`canvas.breakdown.op.${op}` as MessageKey)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {busy && <p className="cw-studio-meta">{t("canvas.breakdown.running")}</p>}
          {error && <p className="cw-reference-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
