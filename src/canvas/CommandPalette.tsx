import { useEffect, useMemo, useRef, useState } from "react";
import { listWorkspaceProjects, type WorkspaceProject } from "../backend/workspace.ts";
import { useT } from "../i18n/I18nProvider.tsx";

export interface PaletteCommand {
  id: string;
  group: "workflows" | "agent" | "desktop" | "projects";
  label: string;
  keywords?: string;
  shortcut?: string;
  secondaryLabel?: string;
  onRun: () => void;
  onSecondary?: () => void;
}

export function CommandPalette({
  open,
  currentProjectId,
  onClose,
  commands,
  onSelectProject,
  onOpenProjectWindow,
}: {
  open: boolean;
  currentProjectId: string;
  onClose: () => void;
  commands: PaletteCommand[];
  onSelectProject: (project: WorkspaceProject) => void;
  onOpenProjectWindow?: (project: WorkspaceProject) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setTimeout(() => inputRef.current?.focus(), 20);
    void listWorkspaceProjects()
      .then((res) => setProjects(res.projects ?? []))
      .catch(() => setProjects([]));
  }, [open]);

  const allItems = useMemo<PaletteCommand[]>(() => {
    const projectItems: PaletteCommand[] = projects
      .filter((project) => project.id !== currentProjectId)
      .map((project) => ({
        id: `project:${project.id}`,
        group: "projects",
        label: project.name,
        keywords: `project open window ${project.name}`,
        secondaryLabel: onOpenProjectWindow ? t("canvas.palette.openNewWindow") : undefined,
        onRun: () => onSelectProject(project),
        onSecondary: onOpenProjectWindow ? () => onOpenProjectWindow(project) : undefined,
      }));
    return [...commands, ...projectItems];
  }, [commands, projects, currentProjectId, onSelectProject, onOpenProjectWindow, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((item) => {
      const hay = `${item.label} ${item.keywords ?? ""} ${item.group}`.toLowerCase();
      return q.split(/\s+/).every((part) => hay.includes(part));
    });
  }, [allItems, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const groupLabels: Record<PaletteCommand["group"], string> = {
    workflows: t("canvas.palette.group.workflows"),
    agent: t("canvas.palette.group.agent"),
    desktop: t("canvas.palette.group.desktop"),
    projects: t("canvas.palette.group.projects"),
  };

  const runItem = (item: PaletteCommand | undefined) => {
    if (!item) return;
    onClose();
    item.onRun();
  };

  return (
    <div
      className="cw-win-modal-backdrop cw-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("canvas.palette.button")}
      data-testid="command-palette"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cw-palette-box">
        <div className="cw-palette-search">
          <span className="cw-palette-icon" aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t("canvas.palette.placeholder")}
            data-testid="command-palette-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((i) =>
                  filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                runItem(filtered[activeIndex]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="cw-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <p className="cw-palette-empty">{t("canvas.palette.empty")}</p>
          ) : (
            filtered.map((item, idx) => {
              const prevGroup = idx > 0 ? filtered[idx - 1].group : null;
              return (
                <div key={item.id}>
                  {prevGroup !== item.group && (
                    <div className="cw-palette-group">{groupLabels[item.group]}</div>
                  )}
                  <div
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`cw-palette-item${idx === activeIndex ? " is-active" : ""}`}
                    data-testid={`palette-cmd-${item.id}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => runItem(item)}
                  >
                    <span className="cw-palette-label">{item.label}</span>
                    <span className="cw-palette-right">
                      {item.secondaryLabel && item.onSecondary && (
                        <button
                          type="button"
                          className="cw-palette-secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            onClose();
                            item.onSecondary!();
                          }}
                        >
                          {item.secondaryLabel}
                        </button>
                      )}
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
