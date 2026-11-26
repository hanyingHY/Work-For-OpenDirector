import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { MessageKey } from "../i18n/types.ts";
import type { CanvasFragment } from "./operations.ts";
import {
  applyCrewPatches,
  buildVirtualCrewCanvasFragment,
  FILM_STYLE_PRESETS,
  generateCrewPlanFromStory,
  recommendStyleFromStory,
  type CrewAspectRatio,
  type VirtualCrewPlan,
} from "./virtualCrew.ts";

interface VirtualCrewDialogProps {
  open: boolean;
  readOnly: boolean;
  onClose: () => void;
  onDeploy: (fragment: CanvasFragment, plan: VirtualCrewPlan) => void;
}

const RATIOS: readonly CrewAspectRatio[] = ["16:9", "9:16", "1:1"];

export function VirtualCrewDialog({
  open,
  readOnly,
  onClose,
  onDeploy,
}: VirtualCrewDialogProps) {
  const { t } = useI18n();
  const [story, setStory] = useState("");
  const [styleId, setStyleId] = useState<string>(FILM_STYLE_PRESETS[0].id);
  const [aspectRatio, setAspectRatio] = useState<CrewAspectRatio>("16:9");
  const [plan, setPlan] = useState<VirtualCrewPlan | null>(null);
  const [activeTab, setActiveTab] = useState<"writers" | "casting" | "shots">("writers");

  if (!open) return null;

  const handleAutoDirect = () => {
    const rec = recommendStyleFromStory(story);
    setStyleId(rec.styleId);
    setAspectRatio(rec.aspectRatio);
    const nextPlan = applyCrewPatches(generateCrewPlanFromStory(story, rec.styleId, rec.aspectRatio));
    setPlan(nextPlan);
    setActiveTab("writers");
  };

  const handleLaunchCrew = () => {
    const nextPlan = generateCrewPlanFromStory(story, styleId, aspectRatio);
    setPlan(nextPlan);
    setActiveTab("writers");
  };

  const handleApplyPatches = () => {
    if (!plan) return;
    setPlan(applyCrewPatches(plan));
  };

  const handleDeploy = () => {
    if (readOnly) return;
    const readyPlan = plan ?? generateCrewPlanFromStory(story, styleId, aspectRatio);
    const fragment = buildVirtualCrewCanvasFragment(readyPlan);
    onDeploy(fragment, readyPlan);
    onClose();
  };

  const allPatched = Boolean(plan && plan.patches.every((p) => p.applied));

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.crew.title")}
      data-testid="virtual-crew-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal cw-crew-modal">
        <header className="cw-win-modal-header">
          <div>
            <h2>{t("canvas.crew.title")}</h2>
            <p>{t("canvas.crew.subtitle")}</p>
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

        <div className="cw-crew-body">
          <div className="cw-crew-story-row">
            <label className="cw-studio-label" htmlFor="crew-story-input">
              {t("canvas.crew.storyLabel")}
            </label>
            <button
              type="button"
              className="cw-crew-autodirect-btn"
              data-testid="crew-autodirect-btn"
              onClick={handleAutoDirect}
            >
              ✦ {t("canvas.crew.autoDirect")}
            </button>
          </div>

          <textarea
            id="crew-story-input"
            className="cw-studio-textarea"
            data-testid="crew-story-input"
            rows={3}
            value={story}
            placeholder={t("canvas.crew.storyPlaceholder")}
            onChange={(e) => setStory(e.target.value)}
          />

          <div className="cw-studio-section">
            <div className="cw-studio-label">{t("canvas.crew.styleLabel")}</div>
            <div className="cw-crew-style-grid">
              {FILM_STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`crew-style-${preset.id}`}
                  className={`cw-crew-style-chip${styleId === preset.id ? " is-active" : ""}`}
                  style={{ "--chip-accent": preset.accentColor } as React.CSSProperties}
                  onClick={() => {
                    setStyleId(preset.id);
                    setAspectRatio(preset.recommendedRatio);
                  }}
                >
                  <span className="cw-crew-style-dot" />
                  <span>{t(preset.labelKey as MessageKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="cw-crew-ratio-row">
            <span className="cw-studio-label">{t("canvas.crew.ratioLabel")}</span>
            <div className="cw-studio-pill-row">
              {RATIOS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`cw-studio-pill${aspectRatio === r ? " is-active" : ""}`}
                  onClick={() => setAspectRatio(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="cw-win-btn is-primary"
              data-testid="crew-launch-btn"
              onClick={handleLaunchCrew}
            >
              {t("canvas.crew.actionStart")}
            </button>
          </div>

          {plan && (
            <div className="cw-crew-departments" data-testid="crew-plan-output">
              <div className="cw-studio-tabs">
                <button
                  type="button"
                  className={`cw-studio-tab${activeTab === "writers" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("writers")}
                >
                  {t("canvas.crew.tab.writers")}
                </button>
                <button
                  type="button"
                  className={`cw-studio-tab${activeTab === "casting" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("casting")}
                >
                  {t("canvas.crew.tab.casting")} ({plan.bible.length})
                </button>
                <button
                  type="button"
                  className={`cw-studio-tab${activeTab === "shots" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("shots")}
                >
                  {t("canvas.crew.tab.shots")} ({plan.shots.length})
                </button>
              </div>

              {activeTab === "writers" && (
                <div className="cw-crew-panel">
                  <div className="cw-crew-score-bar">
                    <div>
                      <span className="cw-crew-score-label">{t("canvas.crew.scoreLabel")}</span>
                      <strong className="cw-crew-score-val" data-testid="crew-review-score">
                        {plan.reviewScore.toFixed(1)} / 10
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="cw-win-btn is-secondary"
                      data-testid="crew-apply-patches-btn"
                      disabled={allPatched}
                      onClick={handleApplyPatches}
                    >
                      {allPatched ? t("canvas.crew.patchesApplied") : t("canvas.crew.applyPatches")}
                    </button>
                  </div>
                  <div className="cw-crew-patch-list">
                    {plan.patches.map((patch) => (
                      <div key={patch.id} className={`cw-crew-patch-item${patch.applied ? " is-applied" : ""}`}>
                        <span className="cw-crew-patch-badge">{patch.applied ? "✓" : "!"}</span>
                        <div>
                          <div className="cw-crew-patch-issue">{patch.issue}</div>
                          <small className="cw-crew-patch-fix">{patch.fix}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "casting" && (
                <div className="cw-crew-bible-grid">
                  {plan.bible.map((asset) => (
                    <div key={asset.id} className="cw-crew-bible-card">
                      <span className="cw-crew-bible-tag">{asset.kind}</span>
                      <strong>{asset.name}</strong>
                      <p>{asset.description}</p>
                      {asset.voice && <small>{asset.voice}</small>}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "shots" && (
                <div className="cw-crew-shot-list">
                  {plan.shots.map((shot) => (
                    <div key={shot.id} className="cw-crew-shot-card">
                      <div className="cw-crew-shot-head">
                        <strong>{shot.title}</strong>
                        <span>{shot.camera} · {shot.durationSec}s</span>
                      </div>
                      <p>{shot.prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="cw-win-modal-footer">
          <button type="button" className="cw-win-btn is-secondary" onClick={onClose}>
            {t("common.close")}
          </button>
          <button
            type="button"
            className="cw-win-btn is-primary"
            data-testid="crew-deploy-canvas-btn"
            disabled={readOnly}
            onClick={handleDeploy}
          >
            {t("canvas.crew.deployCanvas")}
          </button>
        </footer>
      </div>
    </div>
  );
}
