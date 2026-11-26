/**
 * Cinema Director Studio Engine (inspired by Higgsfield Cinema Studio + TapNow 3D Camera & Lighting).
 * Supports layering up to 3 simultaneous camera moves, physical cinema bodies/lenses,
 * and interactive studio lighting moods + key-light direction.
 */

export type CameraMoveCategory = "dolly" | "orbit" | "crane" | "drone" | "tracking" | "special";

export interface CameraMovePreset {
  id: string;
  category: CameraMoveCategory;
  labelEn: string;
  labelZh: string;
  directive: string;
  mood: string;
}

export interface CameraBodyPreset {
  id: string;
  label: string;
  directive: string;
}

export interface LensPreset {
  id: string;
  label: string;
  directive: string;
}

export interface LightingMoodPreset {
  id: string;
  labelEn: string;
  labelZh: string;
  directive: string;
}

export type KeyLightAngle = "top-left" | "top" | "top-right" | "left" | "front" | "right" | "back-rim" | "low-under";

export interface DirectorCameraConfig {
  moves: string[];
  intensity: number; // 1..10
  bodyId: string;
  lensId: string;
  lightingId: string;
  keyLightAngle: KeyLightAngle;
}

export const CAMERA_MOVES: readonly CameraMovePreset[] = [
  { id: "dolly_in", category: "dolly", labelEn: "Slow Dolly In", labelZh: "Slow Dolly In", directive: "slow controlled dolly-in toward subject", mood: "intimacy" },
  { id: "dolly_out", category: "dolly", labelEn: "Dolly Pull Back", labelZh: "Dolly Pull Back", directive: "smooth dolly pull-back revealing full environment", mood: "reveal" },
  { id: "vertigo", category: "dolly", labelEn: "Vertigo Dolly Zoom", labelZh: "Vertigo Dolly Zoom", directive: "Hitchcock vertigo dolly zoom with dramatic background warp", mood: "tension" },
  { id: "push_in_fast", category: "dolly", labelEn: "Dramatic Push In", labelZh: "Dramatic Push In", directive: "rapid assertive push-in to tight eyes close-up", mood: "impact" },
  { id: "orbit_360", category: "orbit", labelEn: "360 Hero Orbit", labelZh: "360 Hero Orbit", directive: "fluid 360-degree orbital camera sweep around hero subject", mood: "heroic" },
  { id: "arc_left", category: "orbit", labelEn: "Arc Left Parallax", labelZh: "Arc Left Parallax", directive: "curved arc-left glide with strong foreground parallax", mood: "depth" },
  { id: "arc_right", category: "orbit", labelEn: "Arc Right Parallax", labelZh: "Arc Right Parallax", directive: "curved arc-right glide keeping subject centered", mood: "depth" },
  { id: "crane_up", category: "crane", labelEn: "Crane High Rise", labelZh: "Crane High Rise", directive: "sweeping crane rise with subtle downward tilt", mood: "epic" },
  { id: "crane_down", category: "crane", labelEn: "Crane Descent", labelZh: "Crane Descent", directive: "smooth crane descent from skyline into street level", mood: "entry" },
  { id: "tilt_up", category: "crane", labelEn: "Heroic Tilt Up", labelZh: "Heroic Tilt Up", directive: "low-angle slow tilt upward emphasizing scale", mood: "monumental" },
  { id: "fpv_dive", category: "drone", labelEn: "FPV Drone Dive", labelZh: "FPV Drone Dive", directive: "high-speed FPV racing drone dive banking through architecture", mood: "adrenaline" },
  { id: "aerial_drift", category: "drone", labelEn: "Aerial Horizon Drift", labelZh: "Aerial Horizon Drift", directive: "high-altitude stabilized aerial lateral drift", mood: "majestic" },
  { id: "low_track", category: "tracking", labelEn: "Low-Angle Tracking", labelZh: "Low-Angle Tracking", directive: "low-angle Steadicam tracking shot skimming wet pavement", mood: "momentum" },
  { id: "handheld_doc", category: "tracking", labelEn: "Handheld Organic", labelZh: "Handheld Organic", directive: "subtle organic handheld cinema camera breathing", mood: "realism" },
  { id: "ots_follow", category: "tracking", labelEn: "Over-the-Shoulder Follow", labelZh: "Over-the-Shoulder Follow", directive: "over-the-shoulder Steadicam follow moving forward", mood: "immersion" },
  { id: "bullet_time", category: "special", labelEn: "Bullet Time Freeze", labelZh: "Bullet Time Freeze", directive: "ultra-slow-motion bullet-time pan around suspended droplets", mood: "spectacle" },
  { id: "crash_zoom", category: "special", labelEn: "Crash Zoom Snap", labelZh: "Crash Zoom Snap", directive: "punchy whip crash zoom snapping onto focal detail", mood: "shock" },
  { id: "rack_focus", category: "special", labelEn: "Shallow Rack Focus", labelZh: "Shallow Rack Focus", directive: "cinematic rack focus pull from foreground bokeh to subject", mood: "narrative" },
];

export const CAMERA_BODIES: readonly CameraBodyPreset[] = [
  { id: "arri_alexa35", label: "ARRI ALEXA 35", directive: "shot on ARRI ALEXA 35, natural filmic highlight roll-off, rich color science" },
  { id: "red_vraptor", label: "RED V-RAPTOR 8K", directive: "shot on RED V-RAPTOR 8K VV, crisp micro-contrast, deep shadows" },
  { id: "sony_venice", label: "Sony VENICE 2", directive: "shot on Sony VENICE 2 full-frame, clean low-light neon latitude" },
  { id: "kodak_35mm", label: "Kodak Vision3 500T 35mm", directive: "shot on Kodak Vision3 500T 35mm celluloid film, subtle halation and organic grain" },
  { id: "imax_70mm", label: "IMAX 70mm", directive: "shot on IMAX 70mm large format, breathtaking clarity and epic spatial depth" },
];

export const LENS_PRESETS: readonly LensPreset[] = [
  { id: "16mm_wide", label: "16mm Ultra-Wide", directive: "16mm ultra-wide prime lens, expansive dramatic perspective" },
  { id: "24mm_cinema", label: "24mm Cinema Prime", directive: "24mm cinema prime lens, balanced environmental storytelling" },
  { id: "35mm_classic", label: "35mm Narrative", directive: "35mm classic cinema lens, natural human perspective" },
  { id: "50mm_portrait", label: "50mm f/1.4", directive: "50mm f/1.4 fast prime, creamy shallow depth of field" },
  { id: "85mm_bokeh", label: "85mm f/1.2 Telephoto", directive: "85mm f/1.2 telephoto portrait lens, intense background compression and bokeh" },
  { id: "anamorphic", label: "Anamorphic 2.39:1", directive: "2x Anamorphic cinema lens, oval bokeh and subtle horizontal blue lens flare" },
];

export const LIGHTING_MOODS: readonly LightingMoodPreset[] = [
  { id: "cyber_neon", labelEn: "Cyberpunk Neon Rim", labelZh: "Cyberpunk Neon Rim", directive: "moody cyan-and-amber volumetric neon lighting with wet specular reflections" },
  { id: "golden_hour", labelEn: "Golden Hour Backlight", labelZh: "Golden Hour Backlight", directive: "warm low-angle golden hour sunlight with atmospheric haze" },
  { id: "rembrandt", labelEn: "Rembrandt Studio", labelZh: "Rembrandt Studio", directive: "classic chiaroscuro Rembrandt key light with sculpted shadow falloff" },
  { id: "commercial_soft", labelEn: "Softbox Commercial", labelZh: "Softbox Commercial", directive: "clean diffused studio softbox lighting with crisp product edge highlights" },
  { id: "noir_lowkey", labelEn: "Noir Low-Key", labelZh: "Noir Low-Key", directive: "high-contrast film noir venetian shadows and dramatic rim separation" },
  { id: "overcast_natural", labelEn: "Natural Overcast", labelZh: "Natural Overcast", directive: "soft diffused natural overcast daylight, grounded documentary tone" },
];

const KEY_LIGHT_DIRECTIVES: Record<KeyLightAngle, string> = {
  "top-left": "45-degree upper-left key light",
  top: "overhead zenith top-down spotlight",
  "top-right": "45-degree upper-right key light",
  left: "hard side key light from camera-left",
  front: "soft axial front fill light",
  right: "sculpted side key light from camera-right",
  "back-rim": "strong silhouette backlight and crisp hair rim light",
  "low-under": "dramatic low-angle uplight casting upward shadows",
};

export const DEFAULT_CAMERA_CONFIG: DirectorCameraConfig = {
  moves: ["dolly_in"],
  intensity: 6,
  bodyId: "arri_alexa35",
  lensId: "35mm_classic",
  lightingId: "cyber_neon",
  keyLightAngle: "top-left",
};

export function toggleCameraMove(current: string[], moveId: string, maxMoves = 3): string[] {
  if (current.includes(moveId)) {
    return current.filter((id) => id !== moveId);
  }
  if (current.length >= maxMoves) {
    return [...current.slice(1), moveId];
  }
  return [...current, moveId];
}

export function compileDirectorDirectives(config: DirectorCameraConfig): {
  cameraSummary: string;
  promptBlock: string;
} {
  const moveObjects = config.moves
    .map((id) => CAMERA_MOVES.find((m) => m.id === id))
    .filter((m): m is CameraMovePreset => Boolean(m));
  const body = CAMERA_BODIES.find((b) => b.id === config.bodyId) ?? CAMERA_BODIES[0];
  const lens = LENS_PRESETS.find((l) => l.id === config.lensId) ?? LENS_PRESETS[2];
  const lighting = LIGHTING_MOODS.find((l) => l.id === config.lightingId) ?? LIGHTING_MOODS[0];
  const speedWord =
    config.intensity <= 3 ? "gentle subtle pace" : config.intensity <= 7 ? "measured cinematic pace" : "energetic high-momentum pace";

  const moveLabels = moveObjects.map((m) => m.labelEn).join(" + ") || "Static Locked Frame";
  const cameraSummary = `${moveLabels} · ${lens.label}`;

  const moveDesc = moveObjects.length
    ? `${moveObjects.map((m) => m.directive).join(" combined with ")} (${speedWord}, motion intensity ${config.intensity}/10)`
    : "locked-off tripod composition";

  const promptBlock = [
    `[Camera] ${moveDesc}`,
    `[Optics] ${body.directive}, ${lens.directive}`,
    `[Lighting] ${lighting.directive}, ${KEY_LIGHT_DIRECTIVES[config.keyLightAngle]}`,
  ].join("; ");

  return { cameraSummary, promptBlock };
}
