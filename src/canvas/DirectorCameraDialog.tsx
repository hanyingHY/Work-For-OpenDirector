import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { MessageKey } from "../i18n/types.ts";
import {
  CAMERA_BODIES,
  CAMERA_MOVES,
  DEFAULT_CAMERA_CONFIG,
  LENS_PRESETS,
  LIGHTING_MOODS,
  toggleCameraMove,
  type DirectorCameraConfig,
  type KeyLightAngle,
} from "./cameraPresets.ts";
import {
  optimizeDirectorPrompt,
  type PromptEnhanceMode,
} from "./promptStudio.ts";

interface DirectorCameraDialogProps {
  open: boolean;
  readOnly: boolean;
  initialPrompt: string;
  onClose: () => void;
  onApply: (payload: {
    optimizedPrompt: string;
    negativeGuard: string;
    summary: string;
  }) => void;
  onNotify: (msg: string) => void;
}

const KEY_ANGLES: readonly { id: KeyLightAngle; label: string }[] = [
  { id: "top-left", label: "↖" },
  { id: "top", label: "↑" },
  { id: "top-right", label: "↗" },
  { id: "left", label: "←" },
  { id: "front", label: "●" },
  { id: "right", label: "→" },
  { id: "back-rim", label: "Rim" },
  { id: "low-under", label: "↓" },
];

const ENHANCE_MODES: readonly PromptEnhanceMode[] = [
  "cinematic",
  "character_lock",
  "physics_lighting",
  "model_kling",
  "model_veo",
  "model_seedance",
  "model_flux",
];

export function DirectorCameraDialog({
  open,
  readOnly,
  initialPrompt,
  onClose,
  onApply,
  onNotify,
}: DirectorCameraDialogProps) {
  const { t } = useI18n();
  const [config, setConfig] = useState<DirectorCameraConfig>(DEFAULT_CAMERA_CONFIG);
  const [rawPrompt, setRawPrompt] = useState(initialPrompt);
  const [anchor, setAnchor] = useState("");
  const [mode, setMode] = useState<PromptEnhanceMode>("cinematic");

  useEffect(() => {
    if (open) {
      setRawPrompt(initialPrompt);
    }
  }, [open, initialPrompt]);

  if (!open) return null;

  const result = optimizeDirectorPrompt(rawPrompt, {
    mode,
    cameraConfig: config,
    characterAnchor: anchor,
    includeNegativeGuard: true,
  });

  const handleCopy = () => {
    const full = result.negativeGuard
      ? `${result.optimized}\n\n[Negative]: ${result.negativeGuard}`
      : result.optimized;
    if (window.opendirectorDesktop?.clipboardWriteText) {
      void window.opendirectorDesktop.clipboardWriteText(full);
    } else if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(full);
    }
    onNotify(t("canvas.camera.copied"));
  };

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.camera.title")}
      data-testid="director-camera-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal cw-camera-modal">
        <header className="cw-win-modal-header">
          <div>
            <h2>{t("canvas.camera.title")}</h2>
            <p>{t("canvas.camera.subtitle")}</p>
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

        <div className="cw-camera-grid">
          <div className="cw-camera-left">
            <div className="cw-studio-section">
              <div className="cw-studio-row-between">
                <span className="cw-studio-label">{t("canvas.camera.movesTitle")}</span>
                <span className="cw-studio-meta">{config.moves.length} / 3</span>
              </div>
              <div className="cw-camera-move-grid">
                {CAMERA_MOVES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`camera-move-${m.id}`}
                    className={`cw-studio-pill${config.moves.includes(m.id) ? " is-active" : ""}`}
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        moves: toggleCameraMove(prev.moves, m.id, 3),
                      }))
                    }
                  >
                    {m.labelEn}
                  </button>
                ))}
              </div>
            </div>

            <div className="cw-studio-row-between cw-studio-section">
              <label className="cw-studio-label" htmlFor="camera-intensity-range">
                {t("canvas.camera.intensity")}: {config.intensity}/10
              </label>
              <input
                id="camera-intensity-range"
                type="range"
                min={1}
                max={10}
                value={config.intensity}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, intensity: Number(e.target.value) }))
                }
              />
            </div>

            <div className="cw-camera-optics-row">
              <div>
                <div className="cw-studio-label">{t("canvas.camera.bodyTitle")}</div>
                <select
                  className="cw-studio-select"
                  value={config.bodyId}
                  onChange={(e) => setConfig((prev) => ({ ...prev, bodyId: e.target.value }))}
                >
                  {CAMERA_BODIES.map((b) => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="cw-studio-label">{t("canvas.camera.lensTitle")}</div>
                <select
                  className="cw-studio-select"
                  value={config.lensId}
                  onChange={(e) => setConfig((prev) => ({ ...prev, lensId: e.target.value }))}
                >
                  {LENS_PRESETS.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="cw-camera-optics-row">
              <div>
                <div className="cw-studio-label">{t("canvas.camera.lightingTitle")}</div>
                <select
                  className="cw-studio-select"
                  value={config.lightingId}
                  onChange={(e) => setConfig((prev) => ({ ...prev, lightingId: e.target.value }))}
                >
                  {LIGHTING_MOODS.map((l) => (
                    <option key={l.id} value={l.id}>{l.labelEn}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="cw-studio-label">{t("canvas.camera.keyLightTitle")}</div>
                <div className="cw-keylight-dial">
                  {KEY_ANGLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`cw-keylight-btn${config.keyLightAngle === item.id ? " is-active" : ""}`}
                      onClick={() => setConfig((prev) => ({ ...prev, keyLightAngle: item.id }))}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="cw-camera-right">
            <div className="cw-studio-label">{t("canvas.camera.promptTitle")}</div>
            <textarea
              className="cw-studio-textarea"
              data-testid="camera-raw-prompt"
              rows={3}
              value={rawPrompt}
              placeholder={t("canvas.camera.promptPlaceholder")}
              onChange={(e) => setRawPrompt(e.target.value)}
            />

            <input
              type="text"
              className="cw-studio-input"
              value={anchor}
              placeholder={t("canvas.camera.anchorPlaceholder")}
              onChange={(e) => setAnchor(e.target.value)}
            />

            <div className="cw-studio-section">
              <div className="cw-studio-label">{t("canvas.camera.modeTitle")}</div>
              <div className="cw-studio-pill-row">
                {ENHANCE_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`prompt-mode-${m}`}
                    className={`cw-studio-pill${mode === m ? " is-active" : ""}`}
                    onClick={() => setMode(m)}
                  >
                    {t(`canvas.camera.mode.${m}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="cw-prompt-preview-box" data-testid="camera-optimized-preview">
              <div className="cw-studio-label">{t("canvas.camera.previewTitle")}</div>
              <p>{result.optimized}</p>
              {result.negativeGuard && (
                <>
                  <div className="cw-studio-label">{t("canvas.camera.negativeTitle")}</div>
                  <small>{result.negativeGuard}</small>
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="cw-win-modal-footer">
          <button type="button" className="cw-win-btn is-secondary" onClick={handleCopy}>
            {t("canvas.camera.copyPrompt")}
          </button>
          <button
            type="button"
            className="cw-win-btn is-primary"
            data-testid="camera-apply-btn"
            disabled={readOnly}
            onClick={() => {
              onApply({
                optimizedPrompt: result.optimized,
                negativeGuard: result.negativeGuard,
                summary: `${config.moves.join("+")} · ${config.bodyId}`,
              });
              onClose();
            }}
          >
            {t("canvas.camera.applyNode")}
          </button>
        </footer>
      </div>
    </div>
  );
}
