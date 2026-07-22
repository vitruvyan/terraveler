"use client";

/**
 * The flat SVG orrery — retained as the low-power/no-WebGL FALLBACK for
 * components/SolarSystem3D.tsx (the immersive three.js orrery). Behavior here
 * is unchanged from before the 3D build; only the scale math moved out to
 * lib/orrery-scale.ts, which is now the single source of truth shared by both
 * renderers.
 */
import {
  SIZE,
  CENTER,
  R_SUN,
  HELIOPAUSE_AU,
  REF_PLANETS,
  projectRadius,
  auToScreen,
  type ScaleMode,
  type MilestonePoint,
} from "@/lib/orrery-scale";

export type { ScaleMode, MilestonePoint };

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
