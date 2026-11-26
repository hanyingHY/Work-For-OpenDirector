/**
 * Workflow Recipe (.odflow.json) Export/Import ("Make Same Style"),
 * Flora/Weavy-style Multi-Branch A/B Experiment Generator,
 * and Project Budget & Cost Governance (#481).
 */
import { createNode, type CanvasNode } from "./model.ts";
import type { CanvasFragment } from "./operations.ts";
import { compileDirectorDirectives, DEFAULT_CAMERA_CONFIG } from "./cameraPresets.ts";

export interface WorkflowRecipeFile {
  schema: "opendirector.recipe.v1";
  title: string;
  exportedAt: string;
  nodeCount: number;
  nodes: Array<{
    refId: string;
    type: CanvasNode["type"];
    title: string;
    x: number;
    y: number;
    text?: string;
    prompt?: string;
  }>;
  edges: Array<{
    sourceRef: string;
    targetRef: string;
    role: "generation_input" | "reference";
  }>;
}

/** Export canvas nodes into a clean, shareable .odflow.json without secrets or local paths. */
export function exportWorkflowRecipe(
  title: string,
  nodes: readonly CanvasNode[],
  edges: readonly { source: string; target: string; role?: string }[],
): WorkflowRecipeFile {
  const minX = nodes.length ? Math.min(...nodes.map((n) => n.position.x)) : 0;
  const minY = nodes.length ? Math.min(...nodes.map((n) => n.position.y)) : 0;
  const idMap = new Map<string, string>();
  const recipeNodes = nodes.map((node, idx) => {
    const refId = `n${idx + 1}`;
    idMap.set(node.id, refId);
    const data = node.data as Record<string, unknown>;
    return {
      refId,
      type: node.type,
      title: typeof data.title === "string" ? data.title : `${node.type}-${idx + 1}`,
      x: Math.round(node.position.x - minX),
      y: Math.round(node.position.y - minY),
      ...(typeof data.text === "string" ? { text: data.text } : {}),
      ...(typeof data.prompt === "string" ? { prompt: data.prompt } : {}),
    };
  });

  const recipeEdges = edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      sourceRef: idMap.get(e.source)!,
      targetRef: idMap.get(e.target)!,
      role: (e.role === "reference" ? "reference" : "generation_input") as "generation_input" | "reference",
    }));

  return {
    schema: "opendirector.recipe.v1",
    title: title || "OpenDirector Recipe",
    exportedAt: new Date().toISOString(),
    nodeCount: recipeNodes.length,
    nodes: recipeNodes,
    edges: recipeEdges,
  };
}

export function parseWorkflowRecipeToFragment(rawJson: string): {
  title: string;
  fragment: CanvasFragment;
} {
  const parsed = JSON.parse(rawJson) as Partial<WorkflowRecipeFile>;
  if (parsed.schema !== "opendirector.recipe.v1" || !Array.isArray(parsed.nodes) || !parsed.nodes.length) {
    throw new Error("Invalid OpenDirector .odflow.json recipe file");
  }
  const refToNode = new Map<string, CanvasNode>();
  const nodes: CanvasNode[] = [];
  for (const item of parsed.nodes) {
    const created = createNode(
      item.type,
      { x: Number(item.x) || 0, y: Number(item.y) || 0 },
      {
        title: item.title,
        ...(item.text ? { text: item.text } : {}),
        ...(item.prompt ? { prompt: item.prompt } : {}),
      },
    );
    refToNode.set(item.refId, created);
    nodes.push(created);
  }
  const edges: CanvasFragment["edges"] = [];
  for (let i = 0; i < (parsed.edges ?? []).length; i++) {
    const e = parsed.edges![i];
    const src = refToNode.get(e.sourceRef);
    const dst = refToNode.get(e.targetRef);
    // Guard OpenDirector contract: only populated text nodes connect as upstream generation_input
    if (src && dst && src.type === "text" && Boolean((src.data as { text?: string }).text?.trim())) {
      edges.push({
        id: `recipe-edge-${i}`,
        source: src.id,
        target: dst.id,
        intent: "generation_input",
      });
    }
  }
  return { title: parsed.title || "Imported Recipe", fragment: { nodes, edges } };
}

export interface AbBranchVariant {
  label: string;
  moveId: string;
  lightingId: string;
  targetKind: "image" | "video";
}

export const DEFAULT_AB_VARIANTS: readonly AbBranchVariant[] = [
  { label: "Variant A · ARRI Dolly + Neon", moveId: "dolly_in", lightingId: "cyber_neon", targetKind: "image" },
  { label: "Variant B · 360 Orbit + Golden Hour", moveId: "orbit_360", lightingId: "golden_hour", targetKind: "image" },
  { label: "Variant C · FPV Dive + Noir", moveId: "fpv_dive", lightingId: "noir_lowkey", targetKind: "video" },
];

/** Spawn Flora/Weavy-style parallel A/B/C comparison branches from a base prompt. */
export function buildAbCompareBranches(
  basePrompt: string,
  variants: readonly AbBranchVariant[] = DEFAULT_AB_VARIANTS,
): CanvasFragment {
  const promptText = basePrompt.trim() || "Rain-drenched neon harbor at dusk, lone courier holding glowing compass";
  const root = createNode("text", { x: 0, y: 120 }, { title: "A/B Experiment Root", text: promptText });
  const nodes: CanvasNode[] = [root];
  const edges: CanvasFragment["edges"] = [];

  variants.forEach((variant, idx) => {
    const compiled = compileDirectorDirectives({
      ...DEFAULT_CAMERA_CONFIG,
      moves: [variant.moveId],
      lightingId: variant.lightingId,
    });
    const branchNode = createNode(
      variant.targetKind,
      { x: 420, y: idx * 260 },
      {
        title: variant.label,
        prompt: `${promptText}. ${compiled.promptBlock}`,
      },
    );
    nodes.push(branchNode);
    edges.push({
      id: `ab-edge-${idx}`,
      source: root.id,
      target: branchNode.id,
      intent: "generation_input",
    });
  });

  return { nodes, edges };
}

export interface ProjectBudgetSummary {
  imageNodes: number;
  videoNodes: number;
  audioNodes: number;
  textNodes: number;
  estimatedCostUsd: number;
  budgetLimitUsd: number;
  utilizationPct: number;
  status: "safe" | "warning" | "exceeded";
}

const UNIT_COST_USD = {
  image: 0.04,
  video: 0.35,
  audio: 0.03,
  text: 0.005,
};

export function summarizeProjectBudget(
  nodes: readonly CanvasNode[],
  budgetLimitUsd = 10,
): ProjectBudgetSummary {
  let imageNodes = 0;
  let videoNodes = 0;
  let audioNodes = 0;
  let textNodes = 0;
  for (const node of nodes) {
    if (node.type === "image") imageNodes += 1;
    else if (node.type === "video") videoNodes += 1;
    else if (node.type === "audio") audioNodes += 1;
    else if (node.type === "text") textNodes += 1;
  }
  const estimatedCostUsd = Number(
    (
      imageNodes * UNIT_COST_USD.image +
      videoNodes * UNIT_COST_USD.video +
      audioNodes * UNIT_COST_USD.audio +
      textNodes * UNIT_COST_USD.text
    ).toFixed(3),
  );
  const safeLimit = Math.max(0.5, Number(budgetLimitUsd) || 10);
  const utilizationPct = Math.min(999, Math.round((estimatedCostUsd / safeLimit) * 100));
  const status: ProjectBudgetSummary["status"] =
    estimatedCostUsd > safeLimit ? "exceeded" : utilizationPct >= 80 ? "warning" : "safe";

  return {
    imageNodes,
    videoNodes,
    audioNodes,
    textNodes,
    estimatedCostUsd,
    budgetLimitUsd: safeLimit,
    utilizationPct,
    status,
  };
}
