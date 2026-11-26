import { useEffect, useState } from "react";
import { useT } from "../i18n/I18nProvider.tsx";
import {
  createDefaultStoryboardRows,
  type StoryboardShotRow,
} from "./storyboardSheet.ts";

export function StoryboardSheetDialog({
  open,
  readOnly = false,
  onClose,
  onGenerate,
}: {
  open: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onGenerate: (rows: StoryboardShotRow[]) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<StoryboardShotRow[]>(() =>
    createDefaultStoryboardRows(t),
  );

  useEffect(() => {
    if (open && rows.length === 0) {
      setRows(createDefaultStoryboardRows(t));
    }
  }, [open, rows.length, t]);

  if (!open) return null;

  const updateRow = (
    id: string,
    patch: Partial<StoryboardShotRow>,
  ) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const addShot = () => {
    const nextIndex = rows.length + 1;
    setRows((prev) => [
      ...prev,
      {
        id: `shot-${Date.now()}-${nextIndex}`,
        title: `#${String(nextIndex).padStart(2, "0")}`,
        camera: "35mm · Tracking",
        prompt: "",
        durationSec: 4,
        voiceover: "",
        mediaKind: nextIndex > 2 ? "video" : "image",
      },
    ]);
  };

  const removeShot = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  };

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.storyboard.title")}
      data-testid="storyboard-sheet-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal cw-storyboard-modal">
        <div className="cw-win-modal-head">
          <div>
            <h2>{t("canvas.storyboard.title")}</h2>
            <p>{t("canvas.storyboard.subtitle")}</p>
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

        <div className="cw-storyboard-table-wrap">
          <table className="cw-storyboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("canvas.storyboard.col.shot")}</th>
                <th>{t("canvas.storyboard.col.camera")}</th>
                <th>{t("canvas.storyboard.col.prompt")}</th>
                <th>{t("canvas.storyboard.col.duration")}</th>
                <th>{t("canvas.storyboard.col.voiceover")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} data-testid={`storyboard-row-${idx}`}>
                  <td className="cw-sb-idx">{idx + 1}</td>
                  <td>
                    <input
                      type="text"
                      value={row.title}
                      disabled={readOnly}
                      onChange={(e) => updateRow(row.id, { title: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.camera}
                      disabled={readOnly}
                      onChange={(e) => updateRow(row.id, { camera: e.target.value })}
                    />
                  </td>
                  <td>
                    <textarea
                      rows={2}
                      value={row.prompt}
                      disabled={readOnly}
                      onChange={(e) => updateRow(row.id, { prompt: e.target.value })}
                    />
                  </td>
                  <td className="cw-sb-dur">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={row.durationSec}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateRow(row.id, {
                          durationSec: Math.max(1, Math.min(30, Number(e.target.value) || 4)),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.voiceover}
                      disabled={readOnly}
                      onChange={(e) => updateRow(row.id, { voiceover: e.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cw-sb-remove"
                      disabled={readOnly || rows.length <= 1}
                      onClick={() => removeShot(row.id)}
                      title={t("canvas.storyboard.remove")}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cw-storyboard-footer">
          <button
            type="button"
            className="cw-sb-add"
            disabled={readOnly}
            data-testid="storyboard-add-shot-btn"
            onClick={addShot}
          >
            + {t("canvas.storyboard.addShot")}
          </button>
          <button
            type="button"
            className="cw-template-apply"
            disabled={readOnly || rows.length === 0}
            data-testid="storyboard-generate-btn"
            onClick={() => {
              onGenerate(rows);
              onClose();
            }}
          >
            {t("canvas.storyboard.generate")}
          </button>
        </div>
      </div>
    </div>
  );
}
