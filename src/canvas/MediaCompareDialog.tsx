import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { CanvasNode } from "./model.ts";
import type { CanvasFragment } from "./operations.ts";
import { buildAbCompareBranches } from "./workflowRecipe.ts";

interface MediaCompareDialogProps {
  open: boolean;
  readOnly: boolean;
  nodes: readonly CanvasNode[];
  basePrompt: string;
  onClose: () => void;
  onSpawnBranches: (fragment: CanvasFragment) => void;
  onPickWinner: (nodeId: string, label: string) => void;
}

export function MediaCompareDialog({
  open,
  readOnly,
  nodes,
  basePrompt,
  onClose,
  onSpawnBranches,
  onPickWinner,
}: MediaCompareDialogProps) {
  const { t } = useI18n();
  const mediaNodes = nodes.filter((n) => n.type === "image" || n.type === "video");
  const [leftId, setLeftId] = useState(mediaNodes[0]?.id ?? "");
  const [rightId, setRightId] = useState(mediaNodes[1]?.id ?? mediaNodes[0]?.id ?? "");
  const [splitPct, setSplitPct] = useState(50);

  if (!open) return null;

  const leftNode = mediaNodes.find((n) => n.id === leftId) ?? mediaNodes[0];
  const rightNode = mediaNodes.find((n) => n.id === rightId) ?? mediaNodes[1] ?? mediaNodes[0];
  const leftData = (leftNode?.data ?? {}) as { title?: string; src?: string; prompt?: string };
  const rightData = (rightNode?.data ?? {}) as { title?: string; src?: string; prompt?: string };

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.compare.title")}
      data-testid="media-compare-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal cw-compare-modal">
        <header className="cw-win-modal-header">
          <div>
            <h2>{t("canvas.compare.title")}</h2>
            <p>{t("canvas.compare.subtitle")}</p>
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

        <div className="cw-compare-top-bar">
          <button
            type="button"
            className="cw-win-btn is-primary"
            data-testid="compare-spawn-ab-btn"
            disabled={readOnly}
            onClick={() => {
              onSpawnBranches(buildAbCompareBranches(basePrompt));
              onClose();
            }}
          >
            {t("canvas.compare.spawnBtn")}
          </button>
        </div>

        {mediaNodes.length < 2 ? (
          <p className="cw-reference-empty">{t("canvas.compare.needTwo")}</p>
        ) : (
          <div className="cw-compare-body">
            <div className="cw-compare-pickers">
              <label>
                <span>{t("canvas.compare.leftLabel")}</span>
                <select
                  className="cw-studio-select"
                  value={leftNode?.id ?? ""}
                  onChange={(e) => setLeftId(e.target.value)}
                >
                  {mediaNodes.map((n, i) => (
                    <option key={n.id} value={n.id}>
                      {(n.data as { title?: string }).title || `${n.type}-${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("canvas.compare.rightLabel")}</span>
                <select
                  className="cw-studio-select"
                  value={rightNode?.id ?? ""}
                  onChange={(e) => setRightId(e.target.value)}
                >
                  {mediaNodes.map((n, i) => (
                    <option key={n.id} value={n.id}>
                      {(n.data as { title?: string }).title || `${n.type}-${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="cw-compare-stage">
              {leftData.src && rightData.src && leftNode?.type === "image" && rightNode?.type === "image" ? (
                <div className="cw-split-viewer">
                  <img src={rightData.src} alt={rightData.title || "B"} className="cw-split-img" />
                  <div className="cw-split-overlay" style={{ width: `${splitPct}%` }}>
                    <img src={leftData.src} alt={leftData.title || "A"} className="cw-split-img" />
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    value={splitPct}
                    className="cw-split-slider"
                    onChange={(e) => setSplitPct(Number(e.target.value))}
                  />
                </div>
              ) : (
                <div className="cw-compare-cards">
                  <div className="cw-compare-card">
                    <span className="cw-compare-badge">A</span>
                    <strong>{leftData.title || leftNode?.type}</strong>
                    {leftData.src && leftNode?.type === "image" && <img src={leftData.src} alt="A" />}
                    {leftData.src && leftNode?.type === "video" && <video src={leftData.src} controls muted />}
                    <p>{leftData.prompt || "—"}</p>
                  </div>
                  <div className="cw-compare-card">
                    <span className="cw-compare-badge">B</span>
                    <strong>{rightData.title || rightNode?.type}</strong>
                    {rightData.src && rightNode?.type === "image" && <img src={rightData.src} alt="B" />}
                    {rightData.src && rightNode?.type === "video" && <video src={rightData.src} controls muted />}
                    <p>{rightData.prompt || "—"}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="cw-compare-actions">
              {leftNode && (
                <button
                  type="button"
                  className="cw-win-btn is-secondary"
                  data-testid="compare-pick-left-btn"
                  disabled={readOnly}
                  onClick={() => {
                    onPickWinner(leftNode.id, leftData.title || "Take A");
                    onClose();
                  }}
                >
                  ★ {t("canvas.compare.pickLeft")}
                </button>
              )}
              {rightNode && (
                <button
                  type="button"
                  className="cw-win-btn is-secondary"
                  data-testid="compare-pick-right-btn"
                  disabled={readOnly}
                  onClick={() => {
                    onPickWinner(rightNode.id, rightData.title || "Take B");
                    onClose();
                  }}
                >
                  ★ {t("canvas.compare.pickRight")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
