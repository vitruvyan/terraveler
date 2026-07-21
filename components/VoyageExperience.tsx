"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Navigator, Voyage, Waypoint } from "@/lib/types";

const DAY = 86_400_000;

type Lens = "log" | "chart";

const SHIP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M3 15h18l-2.1 4.1a2 2 0 0 1-1.8 1.1H6.9a2 2 0 0 1-1.8-1.1L3 15z"/>
  <path d="M12.6 2.2c2.9 3 3.9 7 3.2 11h-3.2V2.2z"/>
  <path d="M11.4 4.4c-2.4 2-3.4 5-2.9 8.8h2.9V4.4z" opacity="0.72"/>
  <rect x="11.4" y="1.6" width="1.2" height="12"/>
</svg>`;

interface Leg {
  wp: Waypoint;
  lng: number; // unwrapped for continuity across the antimeridian
  lat: number;
  arrival: number;
  departure: number;
}

function parseHistoricalDate(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : 0;
  const d = m[3] ? Number(m[3]) : 1;
  return Date.UTC(y, mo, d);
}

function buildLegs(waypoints: Waypoint[]): Leg[] {
  const sorted = [...waypoints].sort((a, b) => a.seq - b.seq);
  const legs: Leg[] = [];
  let prevLng: number | null = null;
  let prevTime = -Infinity;

  for (const wp of sorted) {
    let lng = wp.longitude;
    if (prevLng !== null) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    let arrival = parseHistoricalDate(wp.arrival_date);
    if (arrival === null) arrival = prevTime === -Infinity ? 0 : prevTime + 14 * DAY;
    if (arrival < prevTime) arrival = prevTime + DAY;
    let departure = parseHistoricalDate(wp.departure_date);
    if (departure === null || departure < arrival) departure = arrival;

    legs.push({ wp, lng, lat: wp.latitude, arrival, departure });
    prevLng = lng;
    prevTime = departure;
  }
  return legs;
}

function shipStateAt(t: number, legs: Leg[]): { lng: number; lat: number; index: number } {
  if (legs.length === 0) return { lng: 0, lat: 0, index: 0 };
  if (t <= legs[0].arrival) return { lng: legs[0].lng, lat: legs[0].lat, index: 0 };

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (t <= leg.departure) return { lng: leg.lng, lat: leg.lat, index: i };
    const next = legs[i + 1];
    if (next && t < next.arrival) {
      const f = (t - leg.departure) / (next.arrival - leg.departure);
      return {
        lng: leg.lng + (next.lng - leg.lng) * f,
        lat: leg.lat + (next.lat - leg.lat) * f,
        index: i,
      };
    }
  }
  const last = legs[legs.length - 1];
  return { lng: last.lng, lat: last.lat, index: legs.length - 1 };
}

function traveledLine(t: number, legs: Leg[]): [number, number][] {
  const ship = shipStateAt(t, legs);
  const coords: [number, number][] = [];
  for (let i = 0; i <= ship.index; i++) coords.push([legs[i].lng, legs[i].lat]);
  const last = coords[coords.length - 1];
  if (!last || last[0] !== ship.lng || last[1] !== ship.lat) {
    coords.push([ship.lng, ship.lat]);
  }
  return coords;
}

function lineFeature(coords: [number, number][]) {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

function formatRange(wp: Waypoint): string {
  const parts: string[] = [];
  if (wp.arrival_date && wp.departure_date && wp.departure_date !== wp.arrival_date) {
    parts.push(`${wp.arrival_date} → ${wp.departure_date}`);
  } else if (wp.arrival_date) {
    parts.push(wp.arrival_date);
  }
  if (wp.date_note) parts.push(wp.date_note);
  return parts.join(" · ");
}

// Great-circle distance in nautical miles.
function haversineNm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371; // km
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(s));
  return km / 1.852;
}

// Deterministic thousands separator (avoids SSR/CSR locale mismatch).
function fmtNm(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " nm";
}

function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}`;
}

export default function VoyageExperience({
  navigator,
  voyage,
  waypoints,
}: {
  navigator: Navigator;
  voyage: Voyage;
  waypoints: Waypoint[];
}) {
  const legs = useMemo(() => buildLegs(waypoints), [waypoints]);
  const minTime = legs.length ? legs[0].arrival : 0;
  const maxTime = legs.length ? legs[legs.length - 1].departure : 1;

  // Cumulative sailed distance (nm) up to the start of each leg.
  const cumNm = useMemo(() => {
    const arr: number[] = [0];
    for (let i = 1; i < legs.length; i++) {
      arr[i] =
        arr[i - 1] +
        haversineNm(legs[i - 1].lat, legs[i - 1].lng, legs[i].lat, legs[i].lng);
    }
    return arr;
  }, [legs]);

  const [t, setT] = useState(minTime);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [lens, setLens] = useState<Lens>("log");

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const shipMarkerRef = useRef<any>(null);
  const legsRef = useRef(legs);
  legsRef.current = legs;
  const setTRef = useRef(setT);
  setTRef.current = setT;

  // Initialise the map once.
  useEffect(() => {
    let cancelled = false;
    let map: any;

    (async () => {
      const mod = await import("maplibre-gl");
      const gl: any = (mod as any).default ?? mod;
      if (cancelled || !containerRef.current) return;

      const L = legsRef.current;
      map = new gl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            carto: {
              type: "raster",
              tiles: [
                "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
                "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
                "https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
                "https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors © CARTO",
            },
          },
          layers: [
            { id: "bg", type: "background", paint: { "background-color": "#dcd2b8" } },
            { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.85 } },
          ],
        },
        center: [L[0]?.lng ?? 0, L[0]?.lat ?? 0],
        zoom: 2,
        renderWorldCopies: true,
      });
      mapRef.current = map;

      map.on("load", () => {
        if (!map) return;
        const full = L.map((l) => [l.lng, l.lat] as [number, number]);

        map.addSource("route-full", { type: "geojson", data: lineFeature(full) });
        map.addSource("route-done", { type: "geojson", data: lineFeature([]) });

        map.addLayer({
          id: "route-full",
          type: "line",
          source: "route-full",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#7a2e1d",
            "line-width": 1.5,
            "line-opacity": 0.35,
            "line-dasharray": [2, 3],
          },
        });
        map.addLayer({
          id: "route-done",
          type: "line",
          source: "route-done",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#7a2e1d", "line-width": 3 },
        });

        // Waypoint markers (click to jump there in time).
        L.forEach((l) => {
          const el = document.createElement("div");
          el.className = `wp-dot conf-${l.wp.confidence}`;
          el.title = l.wp.place_historical ?? l.wp.place_modern ?? "";
          el.addEventListener("click", () => setTRef.current(l.arrival));
          new gl.Marker({ element: el }).setLngLat([l.lng, l.lat]).addTo(map!);
        });

        // The moving ship.
        const shipEl = document.createElement("div");
        shipEl.className = "ship-marker";
        shipEl.innerHTML = SHIP_SVG;
        shipMarkerRef.current = new gl.Marker({ element: shipEl })
          .setLngLat([L[0].lng, L[0].lat])
          .addTo(map);

        // Frame the whole voyage.
        const bounds = new gl.LngLatBounds();
        full.forEach((c) => bounds.extend(c));
        map.fitBounds(bounds, { padding: 70, duration: 0 });

        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw the traveled route and reposition the ship whenever time changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const L = legsRef.current;
    const src = map.getSource("route-done");
    if (src) src.setData(lineFeature(traveledLine(t, L)));
    const ship = shipStateAt(t, L);
    shipMarkerRef.current?.setLngLat([ship.lng, ship.lat]);
  }, [t, ready]);

  // Playback loop (~24s for the full voyage).
  useEffect(() => {
    if (!playing) return;
    const span = maxTime - minTime || 1;
    const id = setInterval(() => {
      setT((prev) => {
        const next = prev + span / 600;
        return next >= maxTime ? maxTime : next;
      });
    }, 40);
    return () => clearInterval(id);
  }, [playing, minTime, maxTime]);

  useEffect(() => {
    if (playing && t >= maxTime) setPlaying(false);
  }, [t, playing, maxTime]);

  // Ship state + navigation figures for the current instant.
  const shipNow = shipStateAt(t, legs);
  const idx = shipNow.index;
  const current = legs[idx]?.wp;
  const partialNm = legs.length
    ? haversineNm(legs[idx].lat, legs[idx].lng, shipNow.lat, shipNow.lng)
    : 0;
  const totalNm = (cumNm[idx] ?? 0) + partialNm;
  const legNm = idx > 0 ? cumNm[idx] - cumNm[idx - 1] : 0;
  const daysAtSea = Math.max(0, Math.round((t - minTime) / DAY));

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(t));
  const pct = maxTime > minTime ? ((t - minTime) / (maxTime - minTime)) * 100 : 0;

  function togglePlay() {
    if (!playing) {
      if (t >= maxTime) setT(minTime);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }

  const placeName = current?.place_historical || current?.place_modern || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <header
        style={{
          padding: "10px 18px",
          borderBottom: "1px solid var(--parchment-deep)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 11, color: "var(--brass)" }}>
            Terraveler · Chrono-diary
          </span>
          <h1 style={{ margin: "2px 0 0", fontSize: "1.35rem" }}>{voyage.title}</h1>
        </div>
        <div style={{ textAlign: "right", color: "var(--ink-soft)", fontSize: 13 }}>
          <div>
            <strong>{navigator.name}</strong>
            {navigator.birth_year ? ` (${navigator.birth_year}–${navigator.death_year ?? ""})` : ""}
          </div>
          <div>{voyage.ships}</div>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* Lens switcher */}
        <div className="lens-switch" role="group" aria-label="View lens">
          <button
            className={`lens-btn ${lens === "log" ? "active" : ""}`}
            onClick={() => setLens("log")}
          >
            ⚓ Log
          </button>
          <button
            className={`lens-btn ${lens === "chart" ? "active" : ""}`}
            onClick={() => setLens("chart")}
          >
            🗺 Chart
          </button>
          <button className="lens-btn" disabled title="Coming soon">
            🎨 Art
          </button>
          <button className="lens-btn" disabled title="Coming soon">
            🪶 Peoples
          </button>
        </div>

        {current && (
          <aside
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: "min(360px, 86vw)",
              maxHeight: "calc(100% - 32px)",
              overflow: "auto",
              background: "rgba(242, 230, 207, 0.94)",
              border: "1px solid var(--parchment-deep)",
              borderRadius: 8,
              padding: "16px 18px",
              boxShadow: "0 6px 24px rgba(43, 33, 23, 0.18)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--brass)", letterSpacing: "0.08em" }}>
                Landfall {current.seq}
              </span>
              <span className="conf-badge">{current.confidence}</span>
            </div>
            <h2 style={{ margin: "4px 0 2px", fontSize: "1.3rem" }}>{placeName}</h2>

            {lens === "log" ? (
              <>
                {current.place_modern &&
                  current.place_historical &&
                  current.place_modern !== current.place_historical && (
                    <div style={{ color: "var(--ink-soft)", fontSize: 13, fontStyle: "italic" }}>
                      {current.place_modern}
                    </div>
                  )}
                <div style={{ color: "var(--ink-soft)", fontSize: 13, margin: "6px 0" }}>
                  {formatRange(current)}
                </div>
                {current.event && <p style={{ margin: "8px 0", lineHeight: 1.5 }}>{current.event}</p>}

                {current.diary_excerpt ? (
                  <>
                    <blockquote
                      style={{
                        margin: "12px 0 6px",
                        paddingLeft: 12,
                        borderLeft: "3px solid var(--brass)",
                        fontStyle: "italic",
                        lineHeight: 1.55,
                      }}
                    >
                      “{current.diary_excerpt}”
                    </blockquote>
                    {current.diary_source_citation && (
                      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                        —{" "}
                        {current.diary_source_url ? (
                          <a href={current.diary_source_url} target="_blank" rel="noreferrer">
                            {current.diary_source_citation}
                          </a>
                        ) : (
                          current.diary_source_citation
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", fontStyle: "italic" }}>
                    No verified journal excerpt for this landfall yet.
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ color: "var(--ink-soft)", fontSize: 13, margin: "2px 0 4px" }}>
                  {current.place_modern}
                </div>
                <div className="instruments">
                  <div>
                    <span>Latitude</span>
                    <strong>{fmtLat(shipNow.lat)}</strong>
                  </div>
                  <div>
                    <span>Days at sea</span>
                    <strong>{daysAtSea}</strong>
                  </div>
                  <div>
                    <span>Sailed so far</span>
                    <strong>{fmtNm(totalNm)}</strong>
                  </div>
                  <div>
                    <span>Last passage</span>
                    <strong>{legNm ? fmtNm(legNm) : "—"}</strong>
                  </div>
                  <div>
                    <span>Ports made</span>
                    <strong>
                      {idx + 1} / {legs.length}
                    </strong>
                  </div>
                  <div>
                    <span>Position certainty</span>
                    <strong style={{ textTransform: "capitalize" }}>{current.confidence}</strong>
                  </div>
                </div>
                {current.date_note && (
                  <p className="surveyor-note">Surveyor&rsquo;s note: {current.date_note}</p>
                )}
              </>
            )}
          </aside>
        )}
      </div>

      <div
        style={{
          padding: "12px 18px",
          borderTop: "1px solid var(--parchment-deep)",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <button className="play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div style={{ minWidth: 150 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem" }}>{dateLabel}</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{placeName ? `Off ${placeName}` : ""}</div>
        </div>
        <input
          type="range"
          className="scrubber"
          min={minTime}
          max={maxTime}
          step={DAY}
          value={t}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
          style={{ flex: 1, backgroundSize: `${pct}% 100%` }}
          aria-label="Voyage timeline"
        />
      </div>
    </div>
  );
}
