"use client";

import type { SpaceWaypoint } from "@/lib/types";

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

const SIZE = 640;
const CENTER = SIZE / 2;
const R_SUN = 9;
const R_MAX = CENTER - 40; // leave room for outer labels
const HELIOPAUSE_AU = 119;
const AU_NORM = 0.6; // r0 in the log projection, tuned so inner planets don't bunch at the Sun

/** The eight reference planets, drawn as orbit rings + a schematic marker.
 *  Radii are standard semi-major axes (AU); not the flyby-date positions the
 *  probe's own waypoints carry (those come from the ephemeris — see
 *  data/voyager2.json's _theta_method). */
const REF_PLANETS: { name: string; r_au: number; color: string }[] = [
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

function pathPoints(coords: [number, number][], scale: ScaleMode): string {
  return coords
    .map(([x, y]) => {
      const p = auToScreen(x, y, scale);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");
}

export default function SolarSystemMap({
  fullPath,
  donePath,
  shipAu,
  waypoints,
  activeArrival,
  scale,
  showOrbits,
  showLabels,
  onWaypointClick,
}: {
  /** Every leg's AU-plane position, in seq order — the dashed full route. */
  fullPath: [number, number][];
  /** The AU-plane positions traveled so far — the solid route. */
  donePath: [number, number][];
  /** Current probe position, AU-plane. */
  shipAu: { x: number; y: number };
  /** Clickable milestones (real flybys + the heliopause marker). */
  waypoints: MilestonePoint[];
  activeArrival: number;
  scale: ScaleMode;
  showOrbits: boolean;
  showLabels: boolean;
  onWaypointClick: (arrival: number) => void;
}) {
  const ship = auToScreen(shipAu.x, shipAu.y, scale);

  return (
    <svg
      className="orrery-svg"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Solar system orrery showing Voyager 2's trajectory"
    >
      <defs>
        <radialGradient id="sun-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff3c4" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#ffcf5c" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffcf5c" stopOpacity="0" />
        </radialGradient>
      </defs>

      {showOrbits && (
        <g className="orrery-rings">
          {REF_PLANETS.map((p) => (
            <circle
              key={p.name}
              cx={CENTER}
              cy={CENTER}
              r={projectRadius(p.r_au, scale)}
              className="orrery-ring"
            />
          ))}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={projectRadius(HELIOPAUSE_AU, scale)}
            className="orrery-ring orrery-ring-helio"
          />
        </g>
      )}

      {showLabels && (
        <g className="orrery-labels">
          {REF_PLANETS.map((p) => {
            const R = projectRadius(p.r_au, scale);
            return (
              <g key={p.name} transform={`translate(${CENTER}, ${CENTER - R})`}>
                <circle r={3.5} fill={p.color} className="orrery-planet-dot" />
                <text x={7} y={3.5} className="orrery-planet-label">
                  {p.name}
                </text>
              </g>
            );
          })}
          <g transform={`translate(${CENTER}, ${CENTER - projectRadius(HELIOPAUSE_AU, scale)})`}>
            <text x={7} y={3.5} className="orrery-planet-label orrery-helio-label">
              Heliopause · 119 AU
            </text>
          </g>
        </g>
      )}

      <polyline points={pathPoints(fullPath, scale)} className="orrery-path-full" />
      <polyline points={pathPoints(donePath, scale)} className="orrery-path-done" />

      <circle cx={CENTER} cy={CENTER} r={26} fill="url(#sun-glow)" />
      <circle cx={CENTER} cy={CENTER} r={R_SUN} className="orrery-sun" />

      {waypoints.map((m) => {
        const p = auToScreen(m.x, m.y, scale);
        const hasMedia = !!m.wp.media && m.wp.media.length > 0;
        return (
          <g
            key={m.wp.id}
            transform={`translate(${p.x}, ${p.y})`}
            className={`orrery-wp conf-${m.wp.confidence} ${m.arrival === activeArrival ? "active" : ""}`}
            onClick={() => onWaypointClick(m.arrival)}
            role="button"
            tabIndex={0}
            aria-label={m.wp.body}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onWaypointClick(m.arrival);
            }}
          >
            <circle r={hasMedia ? 7 : 5.5} className="orrery-wp-dot" />
            <title>{m.wp.body}</title>
          </g>
        );
      })}

      <g transform={`translate(${ship.x}, ${ship.y})`} className="probe-marker">
        <path d="M0,-8 L6,6 L0,3 L-6,6 Z" />
      </g>
    </svg>
  );
}
