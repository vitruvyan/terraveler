/**
 * Planet ephemeris — pure math, no three.js, no React.
 *
 * Source: E. M. Standish (JPL), "Keplerian Elements for Approximate Positions
 * of the Major Planets" (table valid 1800 AD - 2050 AD):
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *
 * This is the SAME table data/voyager2.json's `_theta_method` cites for the
 * probe's own flyby theta_deg values ("theta = (L0 + Ldot*T) mod 360, where T
 * is centuries since J2000.0"). Using it here means a planet rendered by
 * SolarSystem3D lines up with where the probe's own recorded waypoint says it
 * met that planet, at each flyby date.
 *
 * Deliberately first-order: mean longitude only, circular-orbit approximation
 * (r = a, ignoring the equation-of-center / eccentricity correction), no
 * inclination or ascending node (this app's orrery is a flat, top-down
 * ecliptic-plane schematic, like the SVG fallback it replaces). Adequate for
 * a schematic orrery, not for precision astronomy — the same caveat
 * voyager2.json's _theta_method already documents for the probe's own
 * waypoints.
 */

export type PlanetName =
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune";

interface Elements {
  /** Semi-major axis at J2000, AU. */
  a: number;
  /** Semi-major axis rate, AU/century (kept for documentation; not applied —
   *  its contribution over this table's ~250-year validity window is well
   *  under the orrery's schematic scale). */
  aDot: number;
  /** Mean longitude at the J2000.0 epoch, degrees. */
  L0: number;
  /** Mean longitude rate, degrees per Julian century. */
  Ldot: number;
}

const ELEMENTS: Record<PlanetName, Elements> = {
  mercury: { a: 0.38709927, aDot: 0.00000037, L0: 252.2503235, Ldot: 149472.67411175 },
  venus: { a: 0.72333566, aDot: 0.0000039, L0: 181.9790995, Ldot: 58517.81538729 },
  earth: { a: 1.00000261, aDot: 0.00000562, L0: 100.46457166, Ldot: 35999.37244981 },
  mars: { a: 1.52371034, aDot: 0.00001847, L0: -4.55343205, Ldot: 19140.30268499 },
  jupiter: { a: 5.202887, aDot: -0.00011607, L0: 34.39644051, Ldot: 3034.74612775 },
  saturn: { a: 9.53667594, aDot: -0.0012506, L0: 49.95424423, Ldot: 1222.49362201 },
  uranus: { a: 19.18916464, aDot: -0.00196176, L0: 313.23810451, Ldot: 428.48202785 },
  neptune: { a: 30.06992276, aDot: 0.00026291, L0: -55.12002969, Ldot: 218.45945325 },
};

export const ALL_PLANETS: PlanetName[] = [
  "mercury",
  "venus",
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
];

const MS_PER_DAY = 86_400_000;
const J2000_JD = 2451545.0; // 2000-01-01 12:00 UTC
// The Unix epoch (1970-01-01 00:00 UTC), expressed as a Julian Date.
const UNIX_EPOCH_JD = 2440587.5;

/** Julian centuries (36525 days each) since J2000.0, for a JS `Date`-style ms timestamp. */
export function julianCenturiesSinceJ2000(tMillis: number): number {
  const jd = tMillis / MS_PER_DAY + UNIX_EPOCH_JD;
  return (jd - J2000_JD) / 36525;
}

function mod360(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Planet's heliocentric ecliptic mean longitude at time `tMillis`
 * (a JS `Date`-style UTC millisecond timestamp, e.g. `Date.UTC(...)`),
 * in degrees, normalized to [0, 360).
 */
export function planetLongitudeDeg(planet: PlanetName, tMillis: number): number {
  const { L0, Ldot } = ELEMENTS[planet];
  const T = julianCenturiesSinceJ2000(tMillis);
  return mod360(L0 + Ldot * T);
}

/** Semi-major axis (AU), treated as constant — see the `aDot` note above. */
export function planetSemiMajorAxisAu(planet: PlanetName): number {
  return ELEMENTS[planet].a;
}

/**
 * Planet position in the SAME true-heliocentric AU-plane convention
 * `buildSpaceLegs` uses in components/SpaceVoyageExperience.tsx:
 *   x = r_au * cos(theta), y = r_au * sin(theta)
 * with theta in standard mathematical (counterclockwise) degrees, and r
 * approximated as the constant semi-major axis (circular-orbit assumption —
 * see the file-level comment).
 */
export function planetPositionAu(planet: PlanetName, tMillis: number): { x: number; y: number } {
  const a = planetSemiMajorAxisAu(planet);
  const thetaRad = (planetLongitudeDeg(planet, tMillis) * Math.PI) / 180;
  return { x: a * Math.cos(thetaRad), y: a * Math.sin(thetaRad) };
}

// --- Correctness gate (verified externally with this exact formula) -----
// planetLongitudeDeg("jupiter", Date.UTC(1979, 6, 9)) => 132.78°, matching
// Jupiter's theta_deg in data/voyager2.json (the 1979-07-09 flyby, ~132.78°).
// The same check passes for every real flyby in that file:
//   earth,   Date.UTC(1977, 7, 20) => 328.53°  (theta_deg 328.53, launch)
//   jupiter, Date.UTC(1979, 6, 9)  => 132.78°  (theta_deg 132.78)
//   saturn,  Date.UTC(1981, 7, 26) => 185.62°  (theta_deg 185.62)
//   uranus,  Date.UTC(1986, 0, 24) => 253.52°  (theta_deg 253.52)
//   neptune, Date.UTC(1989, 7, 25) => 282.26°  (theta_deg 282.26)
// (computed and cross-checked against data/voyager2.json with an independent
// Python re-implementation of this same formula during development).
