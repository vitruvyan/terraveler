/**
 * Pure time/motion helpers shared by every voyage experience — Earth
 * (longitude/latitude) and Space (heliocentric AU-plane coordinates alike.
 *
 * These were extracted verbatim from components/VoyageExperience.tsx (the
 * Earth-only original) and generalized from lng/lat to an abstract {x, y}
 * plane. VoyageExperience re-imports them through a thin lng/lat adapter, so
 * its behavior is unchanged — see the `buildLegs`/`shipStateAt`/
 * `traveledLine` wrappers near the top of that file.
 *
 * The generalisation is deliberately shallow: callers own coordinate meaning
 * (geographic degrees for Earth, true heliocentric AU-plane position for
 * Space) and are responsible for projecting {x, y} onto whatever they render
 * (a MapLibre `<div>` for Earth, an inline SVG orrery for Space). This file
 * only knows about time and straight-line interpolation between waypoints.
 */

export const DAY = 86_400_000;

/** "1768", "1768-04", or "1768-04-06" (partial ISO dates, as used in the data files). */
export function parseHistoricalDate(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : 0;
  const d = m[3] ? Number(m[3]) : 1;
  return Date.UTC(y, mo, d);
}

export interface MotionLeg<T> {
  wp: T;
  x: number;
  y: number;
  arrival: number;
  departure: number;
}

interface DatedPoint {
  seq: number;
  arrival_date: string | null;
  departure_date: string | null;
}

/**
 * Builds ordered "legs" (one per waypoint, sorted by seq) with resolved
 * arrival/departure timestamps and a plane position.
 *
 * `getXY` converts each waypoint into {x, y}; it receives the previous
 * point's resolved x so callers that need continuity across a coordinate
 * wrap (e.g. longitude across the antimeridian) can unwrap there — exactly
 * as the original Earth-only implementation did inline.
 */
export function buildLegs<T extends DatedPoint>(
  waypoints: T[],
  getXY: (wp: T, prevX: number | null) => { x: number; y: number }
): MotionLeg<T>[] {
  const sorted = [...waypoints].sort((a, b) => a.seq - b.seq);
  const legs: MotionLeg<T>[] = [];
  let prevX: number | null = null;
  let prevTime = -Infinity;

  for (const wp of sorted) {
    const { x, y } = getXY(wp, prevX);
    let arrival = parseHistoricalDate(wp.arrival_date);
    if (arrival === null) arrival = prevTime === -Infinity ? 0 : prevTime + 14 * DAY;
    if (arrival < prevTime) arrival = prevTime + DAY;
    let departure = parseHistoricalDate(wp.departure_date);
    if (departure === null || departure < arrival) departure = arrival;

    legs.push({ wp, x, y, arrival, departure });
    prevX = x;
    prevTime = departure;
  }
  return legs;
}

/** Interpolated position + the index of the leg the ship is currently in/at. */
export function shipStateAt<T>(
  t: number,
  legs: MotionLeg<T>[]
): { x: number; y: number; index: number } {
  if (legs.length === 0) return { x: 0, y: 0, index: 0 };
  if (t <= legs[0].arrival) return { x: legs[0].x, y: legs[0].y, index: 0 };

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (t <= leg.departure) return { x: leg.x, y: leg.y, index: i };
    const next = legs[i + 1];
    if (next && t < next.arrival) {
      const f = (t - leg.departure) / (next.arrival - leg.departure);
      return {
        x: leg.x + (next.x - leg.x) * f,
        y: leg.y + (next.y - leg.y) * f,
        index: i,
      };
    }
  }
  const last = legs[legs.length - 1];
  return { x: last.x, y: last.y, index: legs.length - 1 };
}

/** The traveled portion of the route as a polyline, up to time t. */
export function traveledLine<T>(t: number, legs: MotionLeg<T>[]): [number, number][] {
  const ship = shipStateAt(t, legs);
  const coords: [number, number][] = [];
  for (let i = 0; i <= ship.index; i++) coords.push([legs[i].x, legs[i].y]);
  const last = coords[coords.length - 1];
  if (!last || last[0] !== ship.x || last[1] !== ship.y) {
    coords.push([ship.x, ship.y]);
  }
  return coords;
}
