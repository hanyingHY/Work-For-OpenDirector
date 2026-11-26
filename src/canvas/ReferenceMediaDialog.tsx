import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../backend/api.ts";
import {
  consolidateReferenceAsset,
  importReferenceAsset,
  listReferenceAssets,
  relinkReferenceAsset,
  type ReferenceMediaAsset,
} from "../backend/referenceMedia.ts";
import { useT } from "../i18n/I18nProvider.tsx";

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ReferenceMediaDialog({
  open,
  projectId,
  readOnly = false,
  onClose,
  onChanged,
  onPlaceOnCanvas,
  onNotify,
}: {
  open: boolean;
  projectId: string;
  readOnly?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onPlaceOnCanvas?: (asset: ReferenceMediaAsset) => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const t = useT();
  const [items, setItems] = useState<ReferenceMediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [relinkId, setRelinkId] = useState<string | null>(null);
  const [relinkPath, setRelinkPath] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await listReferenceAssets(projectId));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const linkPath = async (rawPath: string) => {
    const trimmed = rawPath.trim();
    if (!trimmed || busy || readOnly) return;
    setBusy(true);
    setError("");
    try {
      const receipt = await importReferenceAsset(projectId, trimmed);
      setPathInput("");
      onNotify(t("canvas.reference.linked", { name: receipt.asset.name }));
      await refresh();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const pickDesktopFiles = async () => {
    const picker = window.opendirectorDesktop?.pickReferenceFiles;
    if (!picker || busy || readOnly) return;
    const result = await picker();
    if (result.canceled || !result.paths.length) return;
    setBusy(true);
    setError("");
    try {
      for (const filePath of result.paths) {
        const receipt = await importReferenceAsset(projectId, filePath);
        onNotify(t("canvas.reference.linked", { name: receipt.asset.name }));
      }
      await refresh();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const submitRelink = async (asset: ReferenceMediaAsset, targetPath: string) => {
    const trimmed = targetPath.trim();
    if (!trimmed || busy || readOnly) return;
    setBusy(true);
    setError("");
    try {
      await relinkReferenceAsset(projectId, asset.assetId, trimmed);
      setRelinkId(null);
      setRelinkPath("");
      onNotify(t("canvas.reference.relinked", { name: asset.name }));
      await refresh();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleConsolidate = async (asset: ReferenceMediaAsset) => {
    if (busy || readOnly) return;
    setBusy(true);
    setError("");
    try {
      await consolidateReferenceAsset(projectId, asset.assetId);
      onNotify(t("canvas.reference.consolidated", { name: asset.name }));
      await refresh();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const hasDesktopPicker = Boolean(window.opendirectorDesktop?.pickReferenceFiles);

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.reference.title")}
      data-testid="reference-media-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal cw-reference-modal">
        <div className="cw-win-modal-head">
          <div>
            <h2>{t("canvas.reference.title")}</h2>
            <p>{t("canvas.reference.subtitle")}</p>
          </div>
          <button
            type="button"
            className="cw-win-modal-close"
            onClick={onClose}
            aria-label={t("canvas.reference.close")}
          >
            ✕
          </button>
        </div>

        <div className="cw-reference-controls">
          {hasDesktopPicker && (
            <button
              type="button"
              className="cw-template-apply"
              disabled={busy || readOnly}
              onClick={() => void pickDesktopFiles()}
            >
              {t("canvas.reference.pickFiles")}
            </button>
          )}
          <form
            className="cw-reference-path-form"
            onSubmit={(event) => {
              event.preventDefault();
              void linkPath(pathInput);
            }}
          >
            <input
              type="text"
              value={pathInput}
              disabled={busy || readOnly}
              placeholder={t("canvas.reference.pathPlaceholder")}
              data-testid="reference-path-input"
              onChange={(event) => setPathInput(event.target.value)}
            />
            <button
              type="submit"
              disabled={busy || readOnly || !pathInput.trim()}
              data-testid="reference-import-btn"
            >
              {busy
                ? t("canvas.reference.importing")
                : t("canvas.reference.importPath")}
            </button>
          </form>
        </div>

        {error && (
          <div className="cw-reference-error" role="alert">
            {error}
          </div>
        )}

        <div className="cw-reference-list">
          {loading && !items.length ? (
            <p className="cw-reference-empty">{t("canvas.reference.importing")}</p>
          ) : !items.length ? (
            <p className="cw-reference-empty">{t("canvas.reference.empty")}</p>
          ) : (
            items.map((item) => (
              <div
                key={item.assetId}
                className={`cw-reference-row is-${item.availability}`}
                data-testid={`reference-row-${item.assetId}`}
              >
                <div className="cw-reference-info">
                  <div className="cw-reference-title">
                    <strong>{item.name}</strong>
                    <span className={`cw-reference-pill is-${item.availability}`}>
                      {item.availability === "online"
                        ? t("canvas.reference.status.online")
                        : item.availability === "offline"
                          ? t("canvas.reference.status.offline")
                          : t("canvas.reference.status.changed")}
                    </span>
                    <small>{formatBytes(item.sizeBytes)}</small>
                  </div>
                  <code className="cw-reference-path">{item.sourcePath}</code>
                  {relinkId === item.assetId && (
                    <form
                      className="cw-reference-relink-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitRelink(item, relinkPath);
                      }}
                    >
                      <input
                        type="text"
                        value={relinkPath}
                        placeholder={t("canvas.reference.relinkPrompt")}
                        data-testid="reference-relink-input"
                        onChange={(event) => setRelinkPath(event.target.value)}
                      />
                      <button
                        type="submit"
                        disabled={busy || !relinkPath.trim()}
                        data-testid="reference-relink-submit"
                      >
                        {t("canvas.reference.relink")}
                      </button>
                    </form>
                  )}
                </div>
                <div className="cw-reference-actions">
                  {onPlaceOnCanvas &&
                    (item.kind === "image" || item.kind === "video" || item.kind === "audio") && (
                      <button
                        type="button"
                        disabled={busy || readOnly || item.availability !== "online"}
                        data-testid="reference-place-btn"
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          try {
                            await onPlaceOnCanvas(item);
                            onNotify(t("canvas.reference.placed", { name: item.name }));
                            onClose();
                          } catch (reason) {
                            setError(errorMessage(reason));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {t("canvas.reference.placeOnCanvas")}
                      </button>
                    )}
                  <button
                    type="button"
                    disabled={busy || readOnly}
                    data-testid="reference-relink-btn"
                    onClick={() => {
                      setRelinkId(
                        relinkId === item.assetId ? null : item.assetId,
                      );
                      setRelinkPath(item.sourcePath);
                    }}
                  >
                    {t("canvas.reference.relink")}
                  </button>
                  <button
                    type="button"
                    disabled={busy || readOnly || item.availability !== "online"}
                    data-testid="reference-consolidate-btn"
                    onClick={() => void handleConsolidate(item)}
                  >
                    {t("canvas.reference.consolidate")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
