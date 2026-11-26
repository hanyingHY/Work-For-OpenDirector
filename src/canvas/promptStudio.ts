/**
 * Smart Prompt Optimizer & Enhancer Studio.
 * Transforms rough ideas or plain prompts into production-grade visual directives
 * tailored to cinematography, character consistency, physics/lighting, or specific video/image models.
 */
import {
  compileDirectorDirectives,
  type DirectorCameraConfig,
} from "./cameraPresets.ts";

export type PromptEnhanceMode =
  | "cinematic"
  | "character_lock"
  | "physics_lighting"
  | "model_kling"
  | "model_veo"
  | "model_seedance"
  | "model_flux";

export interface PromptOptimizeResult {
  original: string;
  optimized: string;
  negativeGuard: string;
  improvements: string[];
}

const MODE_PREFIX: Record<PromptEnhanceMode, string> = {
  cinematic: "Cinematic film still & motion sequence, masterwork art direction, rich storytelling composition",
  character_lock: "Strict character identity preservation across shots, consistent facial geometry, wardrobe silhouette, and hair detail",
  physics_lighting: "Physically plausible fluid/cloth/rain dynamics, volumetric atmospheric depth, micro-surface reflections, natural weight and momentum",
  model_kling: "[Kling 3.0 Motion Spec] Smooth temporal coherence, clear subject-background separation, grounded physical inertia",
  model_veo: "[Veo 3.1 Audio-Visual Spec] Synchronized ambient foley and room tone, realistic acoustics, crisp 24fps cinematic pacing",
  model_seedance: "[Seedance Multi-Shot Spec] Expressive emotional acting beats, seamless continuity framing, crisp East-Asian & global visual fidelity",
  model_flux: "[FLUX Still Master Spec] Editorial photography sharpness, intricate material textures, balanced rule-of-thirds composition",
};

const NEGATIVE_GUARD_DEFAULT =
  "blurry faces, extra fingers, morphed anatomy, flickering textures, plastic CGI sheen, watermark, subtitles overlay, abrupt jump cut";

export function optimizeDirectorPrompt(
  rawPrompt: string,
  options: {
    mode: PromptEnhanceMode;
    cameraConfig?: DirectorCameraConfig;
    characterAnchor?: string;
    includeNegativeGuard?: boolean;
  },
): PromptOptimizeResult {
  const cleaned = rawPrompt.trim();
  const improvements: string[] = [];
  const parts: string[] = [];

  if (cleaned) {
    parts.push(cleaned);
  }
  if (options.characterAnchor?.trim()) {
    parts.push(`[Subject Lock] ${options.characterAnchor.trim()}`);
    improvements.push("subject-lock");
  }

  parts.push(MODE_PREFIX[options.mode]);
  improvements.push(`mode:${options.mode}`);

  if (options.cameraConfig) {
    const compiled = compileDirectorDirectives(options.cameraConfig);
    parts.push(compiled.promptBlock);
    improvements.push("camera-optics-lighting");
  }

  // Quality & temporal stability polish
  if (!/24fps|4k|film|cinematic/i.test(cleaned)) {
    parts.push("24fps cinema cadence, fine filmic texture, cohesive color grade, high dynamic range");
    improvements.push("cinema-grade");
  }

  const optimized = parts.join(". ");
  const negativeGuard = options.includeNegativeGuard === false ? "" : NEGATIVE_GUARD_DEFAULT;

  return {
    original: cleaned,
    optimized,
    negativeGuard,
    improvements,
  };
}
