import { useCallback, useEffect, useState } from "react";
import { errorMessage, request } from "../backend/api.ts";
import { useT } from "../i18n/I18nProvider.tsx";

interface RuntimeHealth {
  status: string;
  apiVersion: string;
  pythonVersion: string;
  platform: string;
  ffmpegAvailable: boolean;
  ffmpegVersion: string | null;
  activity: { agents: number; generations: number; tools: number };
}

export function DesktopHealthDialog({
  open,
  onClose,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  const t = useT();
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [h264Ready, setH264Ready] = useState<boolean | null>(null);
  const [updateMsg, setUpdateMsg] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [error, setError] = useState("");

  const probe = useCallback(async () => {
    setError("");
    try {
      const data = await request<RuntimeHealth>("/desktop/runtime-health");
      setHealth(data);
    } catch (reason) {
      setError(errorMessage(reason));
    }

    try {
      const VideoEncoderCtor = (globalThis as { VideoEncoder?: { isConfigSupported?: (cfg: unknown) => Promise<{ supported?: boolean }> } }).VideoEncoder;
      if (VideoEncoderCtor?.isConfigSupported) {
        const res = await VideoEncoderCtor.isConfigSupported({
          codec: "avc1.42001f",
          width: 1280,
          height: 720,
          bitrate: 2_000_000,
          framerate: 30,
        });
        setH264Ready(Boolean(res?.supported));
      } else {
        setH264Ready(false);
      }
    } catch {
      setH264Ready(false);
    }
  }, []);

  useEffect(() => {
    if (open) void probe();
  }, [open, probe]);

  if (!open) return null;

  const desktop = window.opendirectorDesktop;

  const checkUpdate = async () => {
    if (!desktop?.checkForUpdates) {
      setUpdateMsg(t("canvas.health.updateUnsupported"));
      return;
    }
    setCheckingUpdate(true);
    try {
      const res = await desktop.checkForUpdates();
      if (res.status === "update-available" && res.latestVersion) {
        setUpdateMsg(t("canvas.health.updateAvailable", { version: res.latestVersion }));
      } else if (res.status === "up-to-date") {
        setUpdateMsg(t("canvas.health.updateUpToDate"));
      } else {
        setUpdateMsg(res.error || t("canvas.health.updateUnsupported"));
      }
    } catch (reason) {
      setUpdateMsg(errorMessage(reason));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const copyDiag = async () => {
    if (desktop?.copyDiagnostics) {
      await desktop.copyDiagnostics();
      onNotify(t("canvas.health.diagCopied"));
      return;
    }
    const summary = JSON.stringify(
      {
        platform: desktop?.platform ?? navigator.platform,
        health,
        webcodecsH264: h264Ready,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    );
    await navigator.clipboard?.writeText(summary).catch(() => {});
    onNotify(t("canvas.health.diagCopied"));
  };

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.health.title")}
      data-testid="desktop-health-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal">
        <div className="cw-win-modal-head">
          <div>
            <h2>{t("canvas.health.title")}</h2>
            <p>{t("canvas.health.subtitle")}</p>
          </div>
          <button
            type="button"
            className="cw-win-modal-close"
            onClick={onClose}
            aria-label={t("canvas.templates.close")}
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="cw-reference-error" role="alert">
            {error}
          </div>
        )}

        <div className="cw-health-grid">
          <div className="cw-health-card">
            <div className="cw-health-card-head">
              <strong>{t("canvas.health.pythonHost")}</strong>
              <span className={`cw-reference-pill ${health ? "is-online" : "is-offline"}`}>
                {health ? t("canvas.health.ok") : t("canvas.health.unavailable")}
              </span>
            </div>
            <p>
              {health
                ? `Python ${health.pythonVersion} · API v${health.apiVersion} (${health.platform})`
                : "—"}
            </p>
            {health && (
              <small>
                {t("canvas.health.activeWork", {
                  agents: health.activity.agents,
                  generations: health.activity.generations,
                  tools: health.activity.tools,
                })}
              </small>
            )}
          </div>

          <div className="cw-health-card">
            <div className="cw-health-card-head">
              <strong>{t("canvas.health.ffmpeg")}</strong>
              <span
                className={`cw-reference-pill ${health?.ffmpegAvailable ? "is-online" : "is-changed"}`}
              >
                {health?.ffmpegAvailable ? t("canvas.health.ok") : t("canvas.health.warn")}
              </span>
            </div>
            <p>{health?.ffmpegVersion ?? "FFmpeg"}</p>
          </div>

          <div className="cw-health-card">
            <div className="cw-health-card-head">
              <strong>{t("canvas.health.webcodecs")}</strong>
              <span className={`cw-reference-pill ${h264Ready ? "is-online" : "is-changed"}`}>
                {h264Ready ? t("canvas.health.ok") : t("canvas.health.warn")}
              </span>
            </div>
            <p>H.264 `avc1.42001f` · 1280×720 @ 30fps</p>
          </div>

          <div className="cw-health-card">
            <div className="cw-health-card-head">
              <strong>{t("canvas.health.desktopShell")}</strong>
              <span className={`cw-reference-pill ${desktop ? "is-online" : "is-changed"}`}>
                {desktop ? desktop.platform ?? "win32" : "Web"}
              </span>
            </div>
            <p>{updateMsg || (desktop ? "Electron Native Bridge · D5 Updater" : "Browser Preview")}</p>
          </div>
        </div>

        <div className="cw-storyboard-footer">
          <button type="button" className="cw-sb-add" onClick={() => void probe()}>
            {t("canvas.health.refresh")}
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="cw-sb-add"
              disabled={checkingUpdate}
              data-testid="health-check-update-btn"
              onClick={() => void checkUpdate()}
            >
              {t("canvas.health.checkUpdate")}
            </button>
            <button
              type="button"
              className="cw-template-apply"
              data-testid="health-copy-diag-btn"
              onClick={() => void copyDiag()}
            >
              {t("canvas.health.copyDiag")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
