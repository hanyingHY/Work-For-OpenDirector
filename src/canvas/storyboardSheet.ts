/** Director Storyboard Sheet (inspired by Dreamina Story Mode & TapNow): structured matrix -> canvas + timeline. */
import type { Translate } from "../i18n/I18nProvider.tsx";
import { createNode, type CanvasEdge, type CanvasNode } from "./model.ts";
import type { CanvasFragment } from "./operations.ts";

export interface StoryboardShotRow {
  id: string;
  title: string;
  camera: string;
  prompt: string;
  durationSec: number;
  voiceover: string;
  mediaKind: "image" | "video";
}

export function createDefaultStoryboardRows(t: Translate): StoryboardShotRow[] {
  return [
    {
      id: "shot-1",
      title: t("canvas.storyboard.preset.s1.title"),
      camera: t("canvas.storyboard.preset.s1.camera"),
      prompt: t("canvas.storyboard.preset.s1.prompt"),
      durationSec: 4,
      voiceover: t("canvas.storyboard.preset.s1.vo"),
      mediaKind: "image",
    },
    {
      id: "shot-2",
      title: t("canvas.storyboard.preset.s2.title"),
      camera: t("canvas.storyboard.preset.s2.camera"),
      prompt: t("canvas.storyboard.preset.s2.prompt"),
      durationSec: 4,
      voiceover: t("canvas.storyboard.preset.s2.vo"),
      mediaKind: "image",
    },
    {
      id: "shot-3",
      title: t("canvas.storyboard.preset.s3.title"),
      camera: t("canvas.storyboard.preset.s3.camera"),
      prompt: t("canvas.storyboard.preset.s3.prompt"),
      durationSec: 5,
      voiceover: t("canvas.storyboard.preset.s3.vo"),
      mediaKind: "video",
    },
    {
      id: "shot-4",
      title: t("canvas.storyboard.preset.s4.title"),
      camera: t("canvas.storyboard.preset.s4.camera"),
      prompt: t("canvas.storyboard.preset.s4.prompt"),
      durationSec: 5,
      voiceover: t("canvas.storyboard.preset.s4.vo"),
      mediaKind: "video",
    },
  ];
}

export function buildStoryboardCanvasFragment(
  rows: StoryboardShotRow[],
  t: Translate,
): CanvasFragment {
  const cleanRows = rows.filter(
    (row) => row.title.trim() || row.prompt.trim(),
  );
  const effectiveRows = cleanRows.length
    ? cleanRows
    : createDefaultStoryboardRows(t);

  const scriptLines = effectiveRows.map(
    (row, idx) =>
      `#${idx + 1} ${row.title.trim() || `Shot ${idx + 1}`} [${row.camera.trim() || "35mm"} · ${row.durationSec}s]\n${row.prompt.trim()}${row.voiceover.trim() ? `\nSFX/VO: ${row.voiceover.trim()}` : ""}`,
  );
  const masterNode = createNode(
    "text",
    { x: 0, y: 80 },
    {
      title: t("canvas.storyboard.masterTitle"),
      text: scriptLines.join("\n\n"),
    },
  );
  masterNode.width = 360;
  masterNode.height = Math.min(540, Math.max(240, effectiveRows.length * 105));

  const nodes: CanvasNode[] = [masterNode];
  const edges: CanvasEdge[] = [];

  const cols = 2;
  const startX = 460;
  const colGap = 400;
  const rowGap = 270;

  effectiveRows.forEach((row, index) => {
    const col = index % cols;
    const gridRow = Math.floor(index / cols);
    const fullPrompt = [
      row.camera.trim() ? `[${row.camera.trim()}]` : "",
      row.prompt.trim(),
      row.voiceover.trim() ? `(${row.voiceover.trim()})` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const shotNode = createNode(
      row.mediaKind,
      { x: startX + col * colGap, y: gridRow * rowGap },
      {
        title: row.title.trim() || `Shot ${index + 1}`,
        prompt: fullPrompt,
      },
    );
    shotNode.width = 340;
    shotNode.height = 220;
    nodes.push(shotNode);

    // Master populated script connects into each shot (authoritative text reference).
    edges.push({
      id: crypto.randomUUID(),
      source: masterNode.id,
      target: shotNode.id,
      intent: "generation_input",
    });
  });

  // Assembly timeline node positioned cleanly to the right of the shot matrix.
  const timelineNode = createNode(
    "timeline",
    {
      x: startX + Math.min(cols, effectiveRows.length) * colGap + 60,
      y: 110,
    },
    {
      title: t("canvas.storyboard.timelineTitle"),
    },
  );
  nodes.push(timelineNode);

  return { nodes, edges };
}
