import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAMERA_BODIES,
  CAMERA_MOVES,
  DEFAULT_CAMERA_CONFIG,
  LENS_PRESETS,
  LIGHTING_MOODS,
  compileDirectorDirectives,
  toggleCameraMove,
} from "../src/canvas/cameraPresets.ts";
import { optimizeDirectorPrompt } from "../src/canvas/promptStudio.ts";
import {
  FILM_STYLE_PRESETS,
  applyCrewPatches,
  buildVirtualCrewCanvasFragment,
  generateCrewPlanFromStory,
  recommendStyleFromStory,
} from "../src/canvas/virtualCrew.ts";
import {
  DEFAULT_AB_VARIANTS,
  buildAbCompareBranches,
  exportWorkflowRecipe,
  parseWorkflowRecipeToFragment,
  summarizeProjectBudget,
} from "../src/canvas/workflowRecipe.ts";

describe("v0.4/v0.5 Cinema Director Camera & Lighting Presets", () => {
  it("provides full studio preset catalogs and enforces 3-move stacking cap", () => {
    assert.ok(CAMERA_MOVES.length >= 18);
    assert.ok(CAMERA_BODIES.length >= 5);
    assert.ok(LENS_PRESETS.length >= 6);
    assert.ok(LIGHTING_MOODS.length >= 6);

    let stack: string[] = [];
    stack = toggleCameraMove(stack, "dolly_in");
    stack = toggleCameraMove(stack, "orbit_360");
    stack = toggleCameraMove(stack, "crane_up");
    assert.deepEqual(stack, ["dolly_in", "orbit_360", "crane_up"]);

    stack = toggleCameraMove(stack, "fpv_dive");
    assert.deepEqual(stack, ["orbit_360", "crane_up", "fpv_dive"]);

    stack = toggleCameraMove(stack, "crane_up");
    assert.deepEqual(stack, ["orbit_360", "fpv_dive"]);
  });

  it("compiles ARRI/Lens/Lighting/Key-Angle into cinema directive promptBlock", () => {
    const out = compileDirectorDirectives({
      ...DEFAULT_CAMERA_CONFIG,
      moves: ["dolly_in", "orbit_360"],
      intensity: 4,
      bodyId: "arri_alexa35",
      lensId: "anamorphic",
      lightingId: "cyber_neon",
      keyLightAngle: "back-rim",
    });
    assert.ok(out.promptBlock.includes("ARRI ALEXA 35"));
    assert.ok(out.promptBlock.includes("Anamorphic"));
    assert.ok(out.promptBlock.toLowerCase().includes("dolly"));
    assert.ok(out.promptBlock.toLowerCase().includes("rim"));
    assert.ok(out.cameraSummary.includes("Anamorphic"));
  });
});

describe("v0.4/v0.5 Smart Prompt Optimizer", () => {
  it("upgrades raw prompts across cinematic, character_lock, physics, and model adapters", () => {
    const raw = "A courier running through a neon alley in heavy rain";
    const cin = optimizeDirectorPrompt(raw, {
      mode: "cinematic",
      cameraConfig: DEFAULT_CAMERA_CONFIG,
      includeNegativeGuard: true,
    });
    assert.ok(cin.optimized.length > raw.length);
    assert.ok(cin.improvements.includes("mode:cinematic"));
    assert.ok(cin.improvements.includes("camera-optics-lighting"));
    assert.ok(cin.negativeGuard.includes("watermark"));

    const lock = optimizeDirectorPrompt(raw, {
      mode: "character_lock",
      characterAnchor: "@Hero (yellow raincoat, cracked lantern)",
    });
    assert.ok(lock.optimized.includes("@Hero"));
    assert.ok(lock.improvements.includes("subject-lock"));

    const seedance = optimizeDirectorPrompt(raw, { mode: "model_seedance" });
    assert.ok(seedance.optimized.toLowerCase().includes("seedance") || seedance.optimized.toLowerCase().includes("audio"));

    const kling = optimizeDirectorPrompt(raw, { mode: "model_kling" });
    assert.ok(kling.optimized.toLowerCase().includes("physics") || kling.optimized.toLowerCase().includes("motion"));
  });
});

describe("v0.4/v0.5 Virtual Film Crew (Story-to-Crew)", () => {
  it("recommends matching styles and produces reviewable, patchable multi-department crew plans", () => {
    assert.equal(FILM_STYLE_PRESETS.length, 12);
    assert.equal(recommendStyleFromStory("A cyberpunk hacker rides through neon rain").styleId, "cyberpunk_neon");
    assert.equal(recommendStyleFromStory("A martial arts master crosses misty bamboo mountains").styleId, "chinese_ink");

    const plan = generateCrewPlanFromStory(
      "In a flooded neon harbor, young archivist Lin searches for her missing father's lighthouse map before dawn.",
      "cyberpunk_neon",
      "16:9",
    );

    assert.equal(plan.shots.length, 4);
    assert.ok(plan.bible.some((b) => b.kind === "character"));
    assert.ok(plan.bible.some((b) => b.kind === "location"));
    assert.ok(plan.reviewScore >= 5 && plan.reviewScore <= 10);
    assert.ok(plan.patches.length >= 1);

    const patched = applyCrewPatches(plan);
    assert.ok(patched.reviewScore >= plan.reviewScore);
    assert.equal(patched.patches.every((p) => p.applied), true);

    const fragment = buildVirtualCrewCanvasFragment(patched);
    assert.equal(fragment.nodes.length, 7);
    assert.equal(fragment.edges.length, 8);
    const nodeById = new Map(fragment.nodes.map((n) => [n.id, n]));
    for (const edge of fragment.edges) {
      const src = nodeById.get(edge.source);
      assert.ok(src);
      assert.equal(src.type, "text");
      assert.ok(String((src.data as { text?: string }).text ?? "").trim().length > 0);
    }
  });
});

describe("v0.4/v0.5 Workflow Recipes (.odflow.json), A/B Branches, and Budget Guard (#481)", () => {
  it("exports credential-free .odflow.json and imports back as valid canvas fragment", () => {
    const ab = buildAbCompareBranches("Midnight bullet train entering snowy tunnel", DEFAULT_AB_VARIANTS);
    assert.equal(ab.nodes.length, 4);
    assert.equal(ab.edges.length, 3);

    const recipe = exportWorkflowRecipe("Bullet Train A/B", ab.nodes, ab.edges);
    assert.equal(recipe.schema, "opendirector.recipe.v1");
    assert.equal(recipe.nodeCount, 4);
    const json = JSON.stringify(recipe);
    assert.ok(!json.includes("apiKey"));

    const imported = parseWorkflowRecipeToFragment(json);
    assert.equal(imported.title, "Bullet Train A/B");
    assert.equal(imported.fragment.nodes.length, 4);
    assert.equal(imported.fragment.edges.length, 3);
  });

  it("calculates project spend and raises warning/exceeded budget alerts (#481)", () => {
    const ab = buildAbCompareBranches("Test shot", DEFAULT_AB_VARIANTS);
    const ok = summarizeProjectBudget(ab.nodes, 5);
    assert.equal(ok.imageNodes, 2);
    assert.equal(ok.videoNodes, 1);
    assert.equal(ok.status, "safe");

    // 2 video branches push cost > $0.50 minimum safeLimit
    const heavy = [...ab.nodes, ...ab.nodes];
    const exceeded = summarizeProjectBudget(heavy, 0.5);
    assert.equal(exceeded.status, "exceeded");
    assert.ok(exceeded.estimatedCostUsd > 0.5);
  });
});
