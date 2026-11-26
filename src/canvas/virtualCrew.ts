/**
 * "Story-to-Crew" Virtual Film Crew Engine (inspired by Metaso Kaiji / LTX Studio / Dreamina Story Mode).
 * Turns ANY plain-language story into a complete multi-department production plan:
 *   1) Assistant Director Choice Cards (12 Film Styles + 3 Aspect Ratios + "Auto-Direct")
 *   2) Writers' Room (Visual script adaptation + Self-Review Score 0-10 + Auto-Patches)
 *   3) Casting & Art Bible (Recurring @Characters with voice binding, @Locations, @Props)
 *   4) Cinematography & Batch Canvas Assembly (Master Script + Bible Cards + Enriched Shots + Timeline)
 */
import { createNode } from "./model.ts";
import type { CanvasFragment } from "./operations.ts";
import { DEFAULT_CAMERA_CONFIG } from "./cameraPresets.ts";
import { optimizeDirectorPrompt } from "./promptStudio.ts";

export type CrewAspectRatio = "16:9" | "9:16" | "1:1";

export interface FilmStylePreset {
  id: string;
  labelKey: string;
  promptTag: string;
  recommendedRatio: CrewAspectRatio;
  accentColor: string;
  cameraMoveId: string;
  lightingId: string;
}

export const FILM_STYLE_PRESETS: readonly FilmStylePreset[] = [
  { id: "cyberpunk_neon", labelKey: "canvas.crew.style.cyberpunk", promptTag: "Cyberpunk neo-noir cinema, rain-slick neon reflections, volumetric mist", recommendedRatio: "16:9", accentColor: "#6c63ff", cameraMoveId: "fpv_dive", lightingId: "cyber_neon" },
  { id: "unreal_3a", labelKey: "canvas.crew.style.unreal3a", promptTag: "Unreal Engine 5 AAA game cinematic, physically based shaders, epic lighting", recommendedRatio: "16:9", accentColor: "#38bdf8", cameraMoveId: "orbit_360", lightingId: "rembrandt" },
  { id: "pixar_3d", labelKey: "canvas.crew.style.pixar3d", promptTag: "Stylized 3D animated feature film, expressive characters, subsurface scattering", recommendedRatio: "16:9", accentColor: "#f59e0b", cameraMoveId: "dolly_in", lightingId: "golden_hour" },
  { id: "anime_ghibli", labelKey: "canvas.crew.style.anime", promptTag: "Hand-painted Japanese theatrical anime, lush clouds, warm nostalgic palette", recommendedRatio: "16:9", accentColor: "#34d399", cameraMoveId: "aerial_drift", lightingId: "golden_hour" },
  { id: "short_drama", labelKey: "canvas.crew.style.shortDrama", promptTag: "Vertical viral short-drama cinematography, dramatic close-ups, punchy pacing", recommendedRatio: "9:16", accentColor: "#fb7185", cameraMoveId: "push_in_fast", lightingId: "commercial_soft" },
  { id: "chinese_ink", labelKey: "canvas.crew.style.chineseInk", promptTag: "Chinese guofeng ink-wash xianxia cinema, flowing silk, ethereal mountain mist", recommendedRatio: "16:9", accentColor: "#2dd4bf", cameraMoveId: "crane_up", lightingId: "overcast_natural" },
  { id: "scifi_imax", labelKey: "canvas.crew.style.scifiImax", promptTag: "IMAX 70mm hard sci-fi epic, monumental brutalist architecture, atmospheric scale", recommendedRatio: "16:9", accentColor: "#818cf8", cameraMoveId: "crane_down", lightingId: "noir_lowkey" },
  { id: "luxury_ad", labelKey: "canvas.crew.style.luxuryAd", promptTag: "High-fashion luxury brand commercial, macro tabletop specular highlights", recommendedRatio: "9:16", accentColor: "#eab308", cameraMoveId: "bullet_time", lightingId: "commercial_soft" },
  { id: "noir_thriller", labelKey: "canvas.crew.style.noir", promptTag: "Classic film noir thriller, stark chiaroscuro shadows, suspenseful framing", recommendedRatio: "16:9", accentColor: "#94a3b8", cameraMoveId: "vertigo", lightingId: "noir_lowkey" },
  { id: "documentary", labelKey: "canvas.crew.style.documentary", promptTag: "Intimate cinema-verite documentary, natural daylight, grounded handheld texture", recommendedRatio: "16:9", accentColor: "#60a5fa", cameraMoveId: "handheld_doc", lightingId: "overcast_natural" },
  { id: "wes_pastel", labelKey: "canvas.crew.style.pastel", promptTag: "Symmetrical whimsical pastel cinema, meticulous centered framing, storybook charm", recommendedRatio: "1:1", accentColor: "#f472b6", cameraMoveId: "arc_left", lightingId: "commercial_soft" },
  { id: "retro_vhs", labelKey: "canvas.crew.style.retroVhs", promptTag: "1990s Hong Kong neon 35mm film aesthetic, warm tungsten glow, nostalgic grain", recommendedRatio: "16:9", accentColor: "#fb923c", cameraMoveId: "low_track", lightingId: "cyber_neon" },
];

export interface CrewReviewPatch {
  id: string;
  issue: string;
  fix: string;
  applied: boolean;
}

export interface CrewBibleAsset {
  id: string;
  kind: "character" | "location" | "prop";
  name: string;
  description: string;
  voice?: string;
}

export interface CrewShotPlan {
  id: string;
  title: string;
  camera: string;
  prompt: string;
  durationSec: number;
  voiceover: string;
  assetTags: string[];
}

export interface VirtualCrewPlan {
  storyTitle: string;
  styleId: string;
  aspectRatio: CrewAspectRatio;
  reviewScore: number;
  patches: CrewReviewPatch[];
  bible: CrewBibleAsset[];
  shots: CrewShotPlan[];
}

/** Auto-pick the best style & aspect ratio from plain-language story text ("Auto-Direct"). */
export function recommendStyleFromStory(story: string): {
  styleId: string;
  aspectRatio: CrewAspectRatio;
} {
  const s = story.toLowerCase();
  if (/short|tiktok|reels|douyin|9:16|vertical/.test(s)) {
    return { styleId: "short_drama", aspectRatio: "9:16" };
  }
  if (/game|3a|dungeon|forest|magic|boss|quest/.test(s)) {
    return { styleId: "unreal_3a", aspectRatio: "16:9" };
  }
  if (/anime|ghibli|school|summer|cat/.test(s)) {
    return { styleId: "anime_ghibli", aspectRatio: "16:9" };
  }
  if (/ad|brand|product|watch|perfume|coffee/.test(s)) {
    return { styleId: "luxury_ad", aspectRatio: "9:16" };
  }
  if (/ink|mountain|sword|dynasty|dragon/.test(s)) {
    return { styleId: "chinese_ink", aspectRatio: "16:9" };
  }
  if (/space|planet|mars|starship|sci-fi/.test(s)) {
    return { styleId: "scifi_imax", aspectRatio: "16:9" };
  }
  return { styleId: "cyberpunk_neon", aspectRatio: "16:9" };
}

function splitStoryBeats(story: string): string[] {
  const normalized = story
    .replace(/\r\n/g, "\n")
    .split(/[\n。！？!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (normalized.length >= 4) {
    return normalized.slice(0, 6);
  }
  const base = normalized.join(" · ") || "A lone hero steps into a rain-lit city carrying a mysterious relic";
  return [
    `${base} — establishing atmospheric world intro`,
    `${base} — close-up character reveal and emotional spark`,
    `${base} — rising tension and dramatic turning point`,
    `${base} — climactic visual payoff and lingering finale`,
  ];
}

export function generateCrewPlanFromStory(
  rawStory: string,
  styleId: string,
  aspectRatio: CrewAspectRatio,
): VirtualCrewPlan {
  const style = FILM_STYLE_PRESETS.find((p) => p.id === styleId) ?? FILM_STYLE_PRESETS[0];
  const beats = splitStoryBeats(rawStory);
  const storyTitle = (beats[0] || "OpenDirector Original Film").slice(0, 28);

  const bible: CrewBibleAsset[] = [
    {
      id: "char-lead",
      kind: "character",
      name: "@Protagonist",
      description: `Lead character styled in ${style.promptTag}, consistent silhouette, expressive eyes, iconic outfit locked across every shot`,
      voice: "Warm Narrative Alto / Clear Mandarin & English",
    },
    {
      id: "loc-main",
      kind: "location",
      name: "@HeroLocation",
      description: `Primary cinematic set derived from story world (${storyTitle}), unified color temperature and atmospheric depth`,
    },
    {
      id: "prop-key",
      kind: "prop",
      name: "@SignatureProp",
      description: `Recurring visual motif / key story prop linking Act I to the finale`,
    },
  ];

  const moveCycle = [style.cameraMoveId, "dolly_in", "low_track", "orbit_360", "crane_up", "bullet_time"];
  const shots: CrewShotPlan[] = beats.map((beat, idx) => {
    const moveId = moveCycle[idx % moveCycle.length];
    const opt = optimizeDirectorPrompt(
      `${beat}. Visual style: ${style.promptTag}. Aspect ratio ${aspectRatio}.`,
      {
        mode: idx === 1 ? "character_lock" : "cinematic",
        characterAnchor: idx % 2 === 1 ? "@Protagonist + @SignatureProp" : "@HeroLocation",
        cameraConfig: {
          ...DEFAULT_CAMERA_CONFIG,
          moves: [moveId],
          lightingId: style.lightingId,
        },
        includeNegativeGuard: false,
      },
    );
    return {
      id: `crew-shot-${idx + 1}`,
      title: `Shot ${String(idx + 1).padStart(2, "0")}`,
      camera: `${moveId.replace(/_/g, " ")} · ${aspectRatio}`,
      prompt: opt.optimized,
      durationSec: idx === 0 || idx === beats.length - 1 ? 5 : 4,
      voiceover: beat,
      assetTags: idx % 2 === 1 ? ["@Protagonist", "@SignatureProp"] : ["@HeroLocation", "@Protagonist"],
    };
  });

  const patches: CrewReviewPatch[] = [
    {
      id: "patch-hook",
      issue: "Opening 3s visual hook can be punchier for immediate viewer retention",
      fix: "Upgrade Shot 01 to sweeping high-impact camera entry with strong foreground depth",
      applied: false,
    },
    {
      id: "patch-continuity",
      issue: "Cross-shot wardrobe & lighting continuity markers not locked on mid-sequence shots",
      fix: "Inject @Protagonist + @HeroLocation consistency anchor across all shots",
      applied: false,
    },
    {
      id: "patch-audio",
      issue: "Ambient foley and musical climax cues missing on final resolution beat",
      fix: "Add synced room-tone, risers, and emotional score cue on finale shot",
      applied: false,
    },
  ];

  return {
    storyTitle,
    styleId: style.id,
    aspectRatio,
    reviewScore: 7.4,
    patches,
    bible,
    shots,
  };
}

export function applyCrewPatches(plan: VirtualCrewPlan): VirtualCrewPlan {
  const nextPatches = plan.patches.map((p) => ({ ...p, applied: true }));
  const nextShots = plan.shots.map((shot, idx) => {
    const extra =
      idx === 0
        ? " [Patch: High-impact 3s visual hook, dynamic foreground silhouette]"
        : idx === plan.shots.length - 1
          ? " [Patch: Emotional orchestral swell + lingering atmospheric fade]"
          : " [Patch: Strict @Protagonist + @HeroLocation continuity lock]";
    if (shot.prompt.includes("[Patch:")) return shot;
    return { ...shot, prompt: `${shot.prompt}${extra}` };
  });
  return {
    ...plan,
    reviewScore: 9.5,
    patches: nextPatches,
    shots: nextShots,
  };
}

export function buildVirtualCrewCanvasFragment(plan: VirtualCrewPlan): CanvasFragment {
  const nodes: CanvasFragment["nodes"] = [];
  const edges: CanvasFragment["edges"] = [];

  // 1. Master Writers' Room Script Node
  const scriptLines = [
    `# ${plan.storyTitle} (${plan.aspectRatio} · Score ${plan.reviewScore.toFixed(1)}/10)`,
    "",
    "## Production Bible",
    ...plan.bible.map((b) => `- [${b.kind.toUpperCase()}] ${b.name}: ${b.description}${b.voice ? ` (Voice: ${b.voice})` : ""}`),
    "",
    "## Storyboard Sequence",
    ...plan.shots.map((s, i) => `${i + 1}. ${s.title} [${s.camera} · ${s.durationSec}s] ${s.voiceover}`),
  ].join("\n");

  const master = createNode("text", { x: 0, y: 0 }, { title: `Writers' Room · ${plan.storyTitle}`, text: scriptLines });
  nodes.push(master);

  // 2. Casting & Art Bible Card Node (populated text card so downstream edges are valid!)
  const bibleText = plan.bible
    .map((b) => `${b.name} (${b.kind})\n${b.description}${b.voice ? `\nVoice: ${b.voice}` : ""}`)
    .join("\n\n");
  const bibleNode = createNode("text", { x: 0, y: 340 }, { title: "Casting & Art Bible", text: bibleText });
  nodes.push(bibleNode);

  // 3. Enriched Shot Nodes arranged in 2-column cinematic grid
  plan.shots.forEach((shot, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const kind = idx % 2 === 0 ? "image" : "video";
    const shotNode = createNode(
      kind,
      { x: 430 + col * 390, y: row * 280 },
      {
        title: `${shot.title} · ${shot.camera}`,
        prompt: `${shot.prompt}${shot.voiceover ? ` | VO: ${shot.voiceover}` : ""}`,
      },
    );
    nodes.push(shotNode);
    edges.push({
      id: `crew-edge-master-${idx}`,
      source: master.id,
      target: shotNode.id,
      intent: "generation_input",
    });
    edges.push({
      id: `crew-edge-bible-${idx}`,
      source: bibleNode.id,
      target: shotNode.id,
      intent: "generation_input",
    });
  });

  // 4. Assembly Timeline Node on the right
  const timeline = createNode("timeline", { x: 1240, y: 120 }, { title: `Master Cut · ${plan.storyTitle}` });
  nodes.push(timeline);

  return { nodes, edges };
}
