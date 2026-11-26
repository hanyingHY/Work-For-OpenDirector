import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { createNode, type CanvasEdge, type CanvasNode } from "./model.ts";
import type { CanvasFragment } from "./operations.ts";
import {
  exportNlePackage,
  triggerTextDownload,
  type NleBibleInput,
  type NleShotInput,
} from "../backend/mediaStudio.ts";
import {
  exportWorkflowRecipe,
  parseWorkflowRecipeToFragment,
  summarizeProjectBudget,
} from "./workflowRecipe.ts";

interface ProductionStudioDialogProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  readOnly: boolean;
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  onClose: () => void;
  onInsertFragment: (fragment: CanvasFragment) => void;
  onNotify: (msg: string) => void;
}

const DEFAULT_BIBLE: NleBibleInput[] = [
  {
    kind: "Character",
    name: "@LinXi",
    description: "Wavy bob hair, amber eyes, dark-navy utility trench coat, silver analog camera",
    voice: "Warm Alto · Mandarin / English",
  },
  {
    kind: "Location",
    name: "@RainHarbor",
    description: "Cyberpunk rain-slick container harbor at dusk, cyan & amber volumetric reflections",
  },
];

export function ProductionStudioDialog({
  open,
  projectId,
  projectTitle,
  readOnly,
  nodes,
  edges,
  onClose,
  onInsertFragment,
  onNotify,
}: ProductionStudioDialogProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"bible" | "export" | "budget" | "recipe">("bible");
  const [bible, setBible] = useState<NleBibleInput[]>(DEFAULT_BIBLE);
  const [budgetLimit, setBudgetLimit] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const budget = summarizeProjectBudget(nodes, budgetLimit);

  const collectShotsFromCanvas = (): NleShotInput[] => {
    const mediaNodes = nodes.filter((n) => n.type === "image" || n.type === "video");
    if (mediaNodes.length) {
      return mediaNodes.map((n, idx) => {
        const d = n.data as { title?: string; prompt?: string; assetId?: string };
        return {
          title: d.title || `Shot ${String(idx + 1).padStart(2, "0")}`,
          camera: "Cinema 24fps",
          prompt: d.prompt || "",
          durationSec: 4,
          voiceover: d.title || `Scene ${idx + 1}`,
          assetId: typeof d.assetId === "string" ? d.assetId : undefined,
        };
      });
    }
    return [
      {
        title: "Shot 01 · Establishing Harbor",
        camera: "Aerial Dolly · 24mm",
        prompt: "Neon rain harbor wide establishing frame",
        durationSec: 4,
        voiceover: "Rain falls softly across the quiet harbor.",
      },
      {
        title: "Shot 02 · Character Close-Up",
        camera: "85mm Portrait",
        prompt: "Lead character looks toward the distant beacon",
        durationSec: 5,
        voiceover: "Three years later, the signal returns.",
      },
    ];
  };

  const handleExportNle = async (format: "fcpxml" | "srt" | "pitch_deck") => {
    setBusy(true);
    setError(null);
    try {
      const res = await exportNlePackage(projectId, {
        format,
        title: projectTitle || "OpenDirector Sequence",
        fps: 24,
        width: 1920,
        height: 1080,
        styleLabel: "OpenDirector Cinema Studio",
        aspectRatio: "16:9",
        bible,
        shots: collectShotsFromCanvas(),
      });
      triggerTextDownload(res.filename, res.content, res.mimeType);
      onNotify(t("canvas.studio.exported", { filename: res.filename }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleInsertBible = () => {
    if (readOnly) return;
    const text = bible
      .map(
        (b) =>
          `[${b.kind}] ${b.name}\n${b.description}${b.voice ? `\nVoice: ${b.voice}` : ""}`,
      )
      .join("\n\n");
    const node = createNode("text", { x: 0, y: 0 }, { title: "Production Bible", text });
    onInsertFragment({ nodes: [node], edges: [] });
    onNotify(t("canvas.studio.bibleInserted"));
    onClose();
  };

  const handleExportRecipe = () => {
    const recipe = exportWorkflowRecipe(projectTitle || "OpenDirector Recipe", nodes, edges);
    const json = JSON.stringify(recipe, null, 2);
    triggerTextDownload("opendirector-workflow.odflow.json", json, "application/json; charset=utf-8");
    onNotify(t("canvas.studio.recipeExported"));
  };

  const handleImportRecipeFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const { title, fragment } = parseWorkflowRecipeToFragment(text);
      onInsertFragment(fragment);
      onNotify(t("canvas.studio.recipeImported", { title, count: fragment.nodes.length }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.studio.title")}
      data-testid="production-studio-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal cw-studio-modal">
        <header className="cw-win-modal-header">
          <div>
            <h2>{t("canvas.studio.title")}</h2>
            <p>{t("canvas.studio.subtitle")}</p>
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

        <div className="cw-studio-tabs">
          <button type="button" data-testid="studio-tab-bible" className={`cw-studio-tab${tab === "bible" ? " is-active" : ""}`} onClick={() => setTab("bible")}>
            {t("canvas.studio.tab.bible")}
          </button>
          <button type="button" data-testid="studio-tab-export" className={`cw-studio-tab${tab === "export" ? " is-active" : ""}`} onClick={() => setTab("export")}>
            {t("canvas.studio.tab.export")}
          </button>
          <button type="button" data-testid="studio-tab-budget" className={`cw-studio-tab${tab === "budget" ? " is-active" : ""}`} onClick={() => setTab("budget")}>
            {t("canvas.studio.tab.budget")}
          </button>
          <button type="button" data-testid="studio-tab-recipe" className={`cw-studio-tab${tab === "recipe" ? " is-active" : ""}`} onClick={() => setTab("recipe")}>
            {t("canvas.studio.tab.recipe")}
          </button>
        </div>

        <div className="cw-studio-body">
          {tab === "bible" && (
            <div className="cw-studio-section">
              <div className="cw-bible-editor-list">
                {bible.map((item, idx) => (
                  <div key={idx} className="cw-bible-editor-row">
                    <select
                      className="cw-studio-select"
                      value={item.kind}
                      onChange={(e) =>
                        setBible((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, kind: e.target.value } : row)),
                        )
                      }
                    >
                      <option value="Character">Character</option>
                      <option value="Location">Location</option>
                      <option value="Prop">Prop</option>
                      <option value="Style">Style</option>
                    </select>
                    <input
                      type="text"
                      className="cw-studio-input"
                      value={item.name}
                      onChange={(e) =>
                        setBible((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row)),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="cw-studio-input"
                      value={item.description}
                      onChange={(e) =>
                        setBible((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, description: e.target.value } : row)),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="cw-studio-input"
                      placeholder="@Voice"
                      value={item.voice ?? ""}
                      onChange={(e) =>
                        setBible((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, voice: e.target.value } : row)),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="cw-studio-row-between">
                <button
                  type="button"
                  className="cw-win-btn is-secondary"
                  onClick={() =>
                    setBible((prev) => [
                      ...prev,
                      { kind: "Character", name: `@Asset${prev.length + 1}`, description: "", voice: "" },
                    ])
                  }
                >
                  {t("canvas.studio.bibleAdd")}
                </button>
                <button
                  type="button"
                  className="cw-win-btn is-primary"
                  data-testid="studio-insert-bible-btn"
                  disabled={readOnly}
                  onClick={handleInsertBible}
                >
                  {t("canvas.studio.bibleInsert")}
                </button>
              </div>
            </div>
          )}

          {tab === "export" && (
            <div className="cw-nle-export-grid">
              <button
                type="button"
                className="cw-nle-card"
                data-testid="studio-export-fcpxml-btn"
                disabled={busy}
                onClick={() => void handleExportNle("fcpxml")}
              >
                <strong>Premiere / DaVinci FCPXML</strong>
                <span>{t("canvas.studio.exportXml")}</span>
              </button>
              <button
                type="button"
                className="cw-nle-card"
                data-testid="studio-export-srt-btn"
                disabled={busy}
                onClick={() => void handleExportNle("srt")}
              >
                <strong>SRT Subtitles</strong>
                <span>{t("canvas.studio.exportSrt")}</span>
              </button>
              <button
                type="button"
                className="cw-nle-card"
                data-testid="studio-export-deck-btn"
                disabled={busy}
                onClick={() => void handleExportNle("pitch_deck")}
              >
                <strong>Client Pitch Deck</strong>
                <span>{t("canvas.studio.exportDeck")}</span>
              </button>
            </div>
          )}

          {tab === "budget" && (
            <div className="cw-budget-panel" data-testid="studio-budget-panel">
              <div className="cw-studio-row-between">
                <label className="cw-studio-label" htmlFor="budget-limit-input">
                  {t("canvas.studio.budgetLimit")}
                </label>
                <input
                  id="budget-limit-input"
                  type="number"
                  min={1}
                  step={1}
                  className="cw-studio-input cw-budget-input"
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(Number(e.target.value))}
                />
              </div>
              <div className={`cw-budget-status is-${budget.status}`}>
                <div>
                  <span>{t("canvas.studio.budgetUsed")}</span>
                  <strong>${budget.estimatedCostUsd.toFixed(3)} / ${budget.budgetLimitUsd.toFixed(2)}</strong>
                </div>
                <span className="cw-budget-badge">
                  {budget.status === "exceeded"
                    ? t("canvas.studio.budgetExceeded")
                    : budget.status === "warning"
                      ? t("canvas.studio.budgetWarn")
                      : t("canvas.studio.budgetSafe")}{" "}
                  ({budget.utilizationPct}%)
                </span>
              </div>
              <div className="cw-probe-metrics">
                <span>Images: {budget.imageNodes}</span>
                <span>Videos: {budget.videoNodes}</span>
                <span>Audio: {budget.audioNodes}</span>
                <span>Text: {budget.textNodes}</span>
              </div>
            </div>
          )}

          {tab === "recipe" && (
            <div className="cw-nle-export-grid">
              <button
                type="button"
                className="cw-nle-card"
                data-testid="studio-recipe-export-btn"
                onClick={handleExportRecipe}
              >
                <strong>Export .odflow.json</strong>
                <span>{t("canvas.studio.recipeExport")}</span>
              </button>
              <button
                type="button"
                className="cw-nle-card"
                data-testid="studio-recipe-import-btn"
                disabled={readOnly}
                onClick={() => fileInputRef.current?.click()}
              >
                <strong>Import .odflow.json</strong>
                <span>{t("canvas.studio.recipeImport")}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.odflow.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleImportRecipeFile(file);
                }}
              />
            </div>
          )}

          {error && <p className="cw-reference-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
