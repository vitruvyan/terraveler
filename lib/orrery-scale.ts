import type { SpaceWaypoint } from "@/lib/types";

/**
 * Shared scale math for the Space-voyage orrery — the single source of truth
 * for "the honest scale," used by both renderers:
 *  - components/SolarSystemMap.tsx   (flat SVG orrery — the low-power/no-WebGL fallback)
 *  - components/SolarSystem3D.tsx    (immersive three.js orrery)
 *
 * Extracted verbatim from SolarSystemMap.tsx (behavior unchanged) so a planet,
 * orbit ring, or probe marker projects to the exact same position in both
 * renderers for a given (r_au, theta_deg, scale).
 */

/** log-radial (compresses outer distances so the whole tour fits) or linear
 *  (true to scale, so nothing past Neptune fits on the canvas — the point of
 *  offering the toggle at all). */
export type ScaleMode = "log" | "linear";

export interface MilestonePoint {
  arrival: number;
  x: number; // AU-plane (true heliocentric Cartesian, not yet projected)
  y: number;
  wp: SpaceWaypoint;
}

export const SIZE = 640;
export const CENTER = SIZE / 2;
export const R_SUN = 9;
export const R_MAX = CENTER - 40; // leave room for outer labels
export const HELIOPAUSE_AU = 119;
const AU_NORM = 0.6; // r0 in the log projection, tuned so inner planets don't bunch at the Sun

/** The eight reference planets, drawn as orbit rings + a schematic marker.
 *  Radii are standard semi-major axes (AU); not the flyby-date positions the
 *  probe's own waypoints carry (those come from the ephemeris — see
 *  data/voyager2.json's _theta_method). */
export const REF_PLANETS: { name: string; r_au: number; color: string }[] = [
  { name: "Mercury", r_au: 0.39, color: "#9a958c" },
  { name: "Venus", r_au: 0.72, color: "#d9b96b" },
  { name: "Earth", r_au: 1.0, color: "#5fa8e0" },
  { name: "Mars", r_au: 1.52, color: "#c1613f" },
  { name: "Jupiter", r_au: 5.2, color: "#d3a26a" },
  { name: "Saturn", r_au: 9.58, color: "#e0c98a" },
  { name: "Uranus", r_au: 19.2, color: "#7fd6e0" },
  { name: "Neptune", r_au: 30.05, color: "#5c74e0" },
];

// Log-radial projection: R(r) = R0 + k*ln(1 + r/r0), solved so the optional
// 119 AU heliopause tick still lands inside the canvas.
function logRadius(rAu: number): number {
  const k = (R_MAX - R_SUN) / Math.log(1 + HELIOPAUSE_AU / AU_NORM);
  return R_SUN + k * Math.log(1 + Math.max(0, rAu) / AU_NORM);
}

// Linear projection calibrated so Neptune's orbit reaches the outer margin.
// Anything past it (the heliopause tick, the interstellar cruise points) runs
// off-canvas on purpose — that gap is the reason the log toggle exists.
function linearRadius(rAu: number): number {
  const neptune = REF_PLANETS[REF_PLANETS.length - 1].r_au;
  const k = R_MAX / neptune;
  return rAu * k;
}

export function projectRadius(rAu: number, scale: ScaleMode): number {
  return scale === "log" ? logRadius(rAu) : linearRadius(rAu);
}

/** True heliocentric AU-plane coordinates -> screen pixels for the current scale. */
export function auToScreen(xAu: number, yAu: number, scale: ScaleMode): { x: number; y: number } {
  const r = Math.hypot(xAu, yAu);
  const theta = Math.atan2(yAu, xAu);
  const R = projectRadius(r, scale);
  return { x: CENTER + R * Math.cos(theta), y: CENTER - R * Math.sin(theta) };
}
