/** One-click bilingual production workflow templates (inspired by TapNow & Dreamina Story Mode). */
import type { Translate } from "../i18n/I18nProvider.tsx";
import type { MessageKey } from "../i18n/types.ts";
import type { CanvasEdge, CanvasNode } from "./model.ts";
import type { CanvasFragment } from "./operations.ts";

export interface WorkflowTemplateNodeSpec {
  key: string;
  type: "text" | "image" | "video" | "audio";
  titleKey: MessageKey;
  bodyKey: MessageKey;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowTemplateSpec {
  id: string;
  accent: string;
  titleKey: MessageKey;
  descKey: MessageKey;
  nodes: WorkflowTemplateNodeSpec[];
  edges: Array<{ source: string; target: string }>;
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplateSpec[] = [
  {
    id: "short-film-storyboard",
    accent: "#6c63ff",
    titleKey: "canvas.template.film.title",
    descKey: "canvas.template.film.desc",
    nodes: [
      { key: "outline", type: "text", titleKey: "canvas.template.film.n1.title", bodyKey: "canvas.template.film.n1.body", x: 0, y: 80, width: 320, height: 190 },
      { key: "style", type: "text", titleKey: "canvas.template.film.n2.title", bodyKey: "canvas.template.film.n2.body", x: 0, y: 310, width: 320, height: 180 },
      { key: "shot1", type: "image", titleKey: "canvas.template.film.n3.title", bodyKey: "canvas.template.film.n3.body", x: 410, y: 0, width: 320, height: 220 },
      { key: "shot2", type: "image", titleKey: "canvas.template.film.n4.title", bodyKey: "canvas.template.film.n4.body", x: 410, y: 260, width: 320, height: 220 },
      { key: "shot3", type: "video", titleKey: "canvas.template.film.n5.title", bodyKey: "canvas.template.film.n5.body", x: 820, y: 120, width: 340, height: 240 },
    ],
    edges: [
      { source: "outline", target: "shot1" },
      { source: "style", target: "shot1" },
      { source: "outline", target: "shot2" },
      { source: "style", target: "shot2" },
      { source: "outline", target: "shot3" },
      { source: "style", target: "shot3" },
    ],
  },
  {
    id: "product-commercial",
    accent: "#0ea5e9",
    titleKey: "canvas.template.ad.title",
    descKey: "canvas.template.ad.desc",
    nodes: [
      { key: "brief", type: "text", titleKey: "canvas.template.ad.n1.title", bodyKey: "canvas.template.ad.n1.body", x: 0, y: 80, width: 320, height: 190 },
      { key: "vo", type: "text", titleKey: "canvas.template.ad.n4.title", bodyKey: "canvas.template.ad.n4.body", x: 0, y: 310, width: 320, height: 190 },
      { key: "hero", type: "image", titleKey: "canvas.template.ad.n2.title", bodyKey: "canvas.template.ad.n2.body", x: 420, y: 40, width: 320, height: 220 },
      { key: "lifestyle", type: "video", titleKey: "canvas.template.ad.n3.title", bodyKey: "canvas.template.ad.n3.body", x: 420, y: 300, width: 340, height: 220 },
    ],
    edges: [
      { source: "brief", target: "hero" },
      { source: "brief", target: "lifestyle" },
      { source: "vo", target: "lifestyle" },
    ],
  },
  {
    id: "character-series",
    accent: "#ec4899",
    titleKey: "canvas.template.char.title",
    descKey: "canvas.template.char.desc",
    nodes: [
      { key: "bible", type: "text", titleKey: "canvas.template.char.n1.title", bodyKey: "canvas.template.char.n1.body", x: 0, y: 140, width: 320, height: 200 },
      { key: "sheet", type: "image", titleKey: "canvas.template.char.n2.title", bodyKey: "canvas.template.char.n2.body", x: 410, y: 20, width: 320, height: 220 },
      { key: "sceneA", type: "image", titleKey: "canvas.template.char.n3.title", bodyKey: "canvas.template.char.n3.body", x: 410, y: 270, width: 320, height: 220 },
      { key: "sceneB", type: "video", titleKey: "canvas.template.char.n4.title", bodyKey: "canvas.template.char.n4.body", x: 820, y: 140, width: 340, height: 220 },
    ],
    edges: [
      { source: "bible", target: "sheet" },
      { source: "bible", target: "sceneA" },
      { source: "bible", target: "sceneB" },
    ],
  },
  {
    id: "music-beat-reel",
    accent: "#f59e0b",
    titleKey: "canvas.template.beat.title",
    descKey: "canvas.template.beat.desc",
    nodes: [
      { key: "bpm", type: "text", titleKey: "canvas.template.beat.n1.title", bodyKey: "canvas.template.beat.n1.body", x: 0, y: 140, width: 320, height: 190 },
      { key: "beat1", type: "image", titleKey: "canvas.template.beat.n2.title", bodyKey: "canvas.template.beat.n2.body", x: 410, y: 0, width: 310, height: 210 },
      { key: "beat2", type: "image", titleKey: "canvas.template.beat.n3.title", bodyKey: "canvas.template.beat.n3.body", x: 410, y: 250, width: 310, height: 210 },
      { key: "beat3", type: "video", titleKey: "canvas.template.beat.n4.title", bodyKey: "canvas.template.beat.n4.body", x: 800, y: 120, width: 330, height: 230 },
    ],
    edges: [
      { source: "bpm", target: "beat1" },
      { source: "bpm", target: "beat2" },
      { source: "bpm", target: "beat3" },
    ],
  },
];

export function buildWorkflowTemplateFragment(
  template: WorkflowTemplateSpec,
  t: Translate,
): CanvasFragment {
  const keyToId = new Map<string, string>();
  const nodes: CanvasNode[] = template.nodes.map((spec) => {
    const id = crypto.randomUUID();
    keyToId.set(spec.key, id);
    const title = t(spec.titleKey);
    const body = t(spec.bodyKey);
    return {
      id,
      type: spec.type,
      position: { x: spec.x, y: spec.y },
      width: spec.width,
      height: spec.height,
      data:
        spec.type === "text"
          ? { kind: "text", title, text: body, prompt: "" }
          : { kind: spec.type, title, prompt: body },
    };
  });

  const edges: CanvasEdge[] = template.edges.flatMap((edge) => {
    const source = keyToId.get(edge.source);
    const target = keyToId.get(edge.target);
    if (!source || !target) return [];
    return [
      {
        id: crypto.randomUUID(),
        source,
        target,
        intent: "generation_input",
      },
    ];
  });

  return { nodes, edges };
}
