import { useState } from "react";
import { useT } from "../i18n/I18nProvider.tsx";
import {
  WORKFLOW_TEMPLATES,
  type WorkflowTemplateSpec,
} from "./workflowTemplates.ts";

export function WorkflowTemplatesDialog({
  open,
  readOnly = false,
  onClose,
  onApply,
}: {
  open: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onApply: (template: WorkflowTemplateSpec) => void;
}) {
  const t = useT();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  if (!open) return null;

  return (
    <div
      className="cw-win-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.templates.title")}
      data-testid="workflow-templates-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cw-win-modal">
        <div className="cw-win-modal-head">
          <div>
            <h2>{t("canvas.templates.title")}</h2>
            <p>{t("canvas.templates.subtitle")}</p>
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
        <div className="cw-template-grid">
          {WORKFLOW_TEMPLATES.map((template) => (
            <article
              key={template.id}
              className="cw-template-card"
              style={{ ["--tpl-accent" as string]: template.accent }}
              data-testid={`workflow-template-${template.id}`}
            >
              <div className="cw-template-card-top">
                <span className="cw-template-dot" aria-hidden="true" />
                <span className="cw-template-count">
                  {t("canvas.templates.nodesCount", {
                    count: template.nodes.length,
                  })}
                </span>
              </div>
              <h3>{t(template.titleKey)}</h3>
              <p>{t(template.descKey)}</p>
              <button
                type="button"
                className="cw-template-apply"
                disabled={readOnly || applyingId !== null}
                data-testid={`apply-template-${template.id}`}
                onClick={() => {
                  setApplyingId(template.id);
                  try {
                    onApply(template);
                    onClose();
                  } finally {
                    setApplyingId(null);
                  }
                }}
              >
                {applyingId === template.id
                  ? t("canvas.templates.applying")
                  : t("canvas.templates.apply")}
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
