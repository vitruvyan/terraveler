"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Navigator, Voyage, Waypoint } from "@/lib/types";
import worldEventsData from "@/data/world_events.json";
import DraggableWindow from "@/components/DraggableWindow";
import AccountPanel from "@/components/AccountPanel";

const DAY = 86_400_000;

type Lens = "log" | "chart" | "carto";

type WorldEvent = {
  date: string;
  title: string;
  blurb: string;
  category: string;
  region: string;
  source_url: string;
};

// Great powers of ~1715 (matches the EMPIRE field baked into world_1715.geojson).
const EMPIRE_COLORS: Array<[string, string]> = [
  ["British", "#b04a3c"],
  ["French", "#3f5f9a"],
  ["Spanish", "#d0a23f"],
  ["Portuguese", "#3f8a5a"],
  ["Dutch", "#e07a2e"],
  ["Habsburg (Austria)", "#b3a13f"],
  ["Russian (Muscovy)", "#7d5a9a"],
  ["Qing (Manchu)", "#c2653a"],
  ["Mughal", "#a24a6e"],
  ["Safavid (Persia)", "#3f9090"],
  ["Ottoman", "#6b8f3f"],
  ["Japan (Tokugawa)", "#9a4560"],
];
const OTHER_COLOR = "#d9caa4";

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

  // World events within THIS voyage's window, on the same time axis.
  const events = useMemo(
    () =>
      (worldEventsData as WorldEvent[])
        .map((e) => ({ ...e, time: parseHistoricalDate(e.date) ?? minTime }))
        .filter((e) => e.time >= minTime && e.time <= maxTime)
        .sort((a, b) => a.time - b.time),
    [minTime, maxTime]
  );

  const [t, setT] = useState(minTime);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [lens, setLens] = useState<Lens>("log");
  const [showHist, setShowHist] = useState(true);
  const [autopause, setAutopause] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stripHover, setStripHover] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);

  // Cartouche: remember collapsed state; start collapsed on small screens.
  useEffect(() => {
    try {
      if (localStorage.getItem("cartouche") === "min" || window.innerWidth < 680) {
        setCartOpen(false);
      }
    } catch { /* ignore */ }
  }, []);
  function toggleCart(open: boolean) {
    setCartOpen(open);
    try { localStorage.setItem("cartouche", open ? "open" : "min"); } catch { /* ignore */ }
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const shipMarkerRef = useRef<any>(null);
  const legsRef = useRef(legs);
  legsRef.current = legs;
  const setTRef = useRef(setT);
  setTRef.current = setT;
  // Open the Log window at a specific landfall (used by route dots & timeline ticks).
  const openLogRef = useRef<(arrival: number) => void>(() => {});
  openLogRef.current = (arrival: number) => {
    setT(arrival);
    setLens("log");
    setPanelOpen(true);
  };

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
            { id: "bg", type: "background", paint: { "background-color": "#dfe4e6" } },
            { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 1 } },
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

        // Political world at Bougainville's time — borders c. 1715, the closest
        // available to 1766 (a mid-18th-century reconstruction).
        map.addSource("hist", { type: "geojson", data: "/world_1715.geojson" });
        const empireColor: any = ["match", ["get", "EMPIRE"]];
        EMPIRE_COLORS.forEach(([k, c]) => empireColor.push(k, c));
        empireColor.push(OTHER_COLOR);
        map.addLayer({
          id: "hist-fill",
          type: "fill",
          source: "hist",
          paint: { "fill-color": empireColor, "fill-opacity": 0.5 },
        });
        map.addLayer({
          id: "hist-line",
          type: "line",
          source: "hist",
          paint: { "line-color": "#6b4a2a", "line-width": 0.8, "line-opacity": 0.55 },
        });

        // Hover a territory to reveal its name and sovereign of the era.
        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const histPopup = new gl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "hist-popup",
          offset: 8,
        });
        map.on("mousemove", "hist-fill", (e: any) => {
          const f = e.features && e.features[0];
          const p = (f && f.properties) || {};
          const name = String(p.NAME || "").trim();
          if (!name) {
            histPopup.remove();
            return;
          }
          const emp = p.EMPIRE && p.EMPIRE !== "Other" ? String(p.EMPIRE) : "";
          histPopup
            .setLngLat(e.lngLat)
            .setHTML(
              `<strong>${esc(name)}</strong>${emp ? `<span class="hp-emp"> · ${esc(emp)}</span>` : ""}`
            )
            .addTo(map);
        });
        map.on("mouseleave", "hist-fill", () => histPopup.remove());

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
          el.addEventListener("click", () => openLogRef.current(l.arrival));
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
        if (autopause) {
          // Stop at the next milestone on EITHER timeline — landfall or world event.
          const nextLeg = legs.find((l) => l.arrival > prev + 1)?.arrival ?? Infinity;
          const nextEv = events.find((e) => e.time > prev + 1)?.time ?? Infinity;
          const stop = Math.min(nextLeg, nextEv);
          if (Number.isFinite(stop) && next >= stop) {
            setPlaying(false);
            return stop;
          }
        }
        if (next >= maxTime) {
          setPlaying(false);
          return maxTime;
        }
        return next;
      });
    }, 40);
    return () => clearInterval(id);
  }, [playing, minTime, maxTime, autopause, legs, events]);

  useEffect(() => {
    if (playing && t >= maxTime) setPlaying(false);
  }, [t, playing, maxTime]);

  // Toggle the 1715 political overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const vis = showHist ? "visible" : "none";
    ["hist-fill", "hist-line"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
    });
  }, [showHist, ready]);

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

  // Current world event = the most recent one on or before the ship's date.
  let worldNow: (WorldEvent & { time: number }) | null = null;
  for (const e of events) {
    if (e.time <= t) worldNow = e;
    else break;
  }
  const pctOf = (time: number) =>
    Math.max(
      0,
      Math.min(100, maxTime > minTime ? ((time - minTime) / (maxTime - minTime)) * 100 : 0)
    );

  function togglePlay() {
    setPanelOpen(true);
    if (!playing) {
      if (t >= maxTime) setT(minTime);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }

  const placeName = current?.place_historical || current?.place_modern || "";
  const panelTitle =
    lens === "log" ? "Ship's Log" : lens === "chart" ? "Navigation Chart" : "Cartographer";

  return (
    <div style={{ position: "relative", height: "100dvh", overflow: "hidden" }}>
      {/* Cartouche — the map's own title box, per voyage. Doubles as the future voyage picker. */}
      <div className="left-stack">
        {cartOpen ? (
          <div className="cartouche">
            <div className="cart-head">
              <span className="cart-kicker">Terraveler · Chrono-diary</span>
              <button className="win-btn" onClick={() => toggleCart(false)} aria-label="Minimize" title="Minimize">
                –
              </button>
            </div>
            <h1 className="cart-title">{voyage.title}</h1>
            <div className="cart-nav">
              <strong>{navigator.name}</strong>
              {navigator.birth_year ? ` (${navigator.birth_year}–${navigator.death_year ?? ""})` : ""}
            </div>
            <div className="cart-ships">{voyage.ships}</div>
            <div className="cart-atlas">
              <span className="cart-atlas-label">Atlas</span>
              <a href="/" className={voyage.slug === "boudeuse-1766" ? "cur" : ""}>
                Bougainville 1766
              </a>
              <a href="/voyage/boussole-1785" className={voyage.slug === "boussole-1785" ? "cur" : ""}>
                La Pérouse 1785
              </a>
            </div>
          </div>
        ) : (
          <button className="cart-emblem" onClick={() => toggleCart(true)} title={voyage.title} aria-label="Voyage title">
            🧭
          </button>
        )}
        {/* Lens switcher — icons only, hover reveals what they are */}
        <div className="lens-switch" role="group" aria-label="View lens">
          <button
            className={`lens-btn lens-btn-ico ${lens === "log" ? "active" : ""}`}
            title="Ship's Log — the journal at each landfall"
            aria-label="Ship's Log"
            onClick={() => {
              setLens("log");
              setPanelOpen(true);
            }}
          >
            ⚓
          </button>
          <button
            className={`lens-btn lens-btn-ico ${lens === "chart" ? "active" : ""}`}
            title="Navigation Chart — the voyage's instruments"
            aria-label="Navigation Chart"
            onClick={() => {
              setLens("chart");
              setPanelOpen(true);
            }}
          >
            🗺
          </button>
          <button
            className={`lens-btn lens-btn-ico ${lens === "carto" ? "active" : ""}`}
            title="Cartographer — map layers and legend"
            aria-label="Cartographer"
            onClick={() => {
              setLens("carto");
              setPanelOpen(true);
            }}
          >
            🧭
          </button>
          <button className="lens-btn lens-btn-ico" disabled title="Art — coming soon" aria-label="Art (coming soon)">
            🎨
          </button>
          <button className="lens-btn lens-btn-ico" disabled title="Peoples — coming soon" aria-label="Peoples (coming soon)">
            🪶
          </button>
        </div>
      </div>

      {/* Top-right: account + compass menu */}
      <div className="tr-cluster">
        <div style={{ position: "relative" }}>
          <button className="tr-btn" onClick={() => setMenuOpen((m) => !m)} aria-label="Menu" title="Menu">
            ☰
          </button>
          {menuOpen && (
            <div className="tr-menu" onClick={() => setMenuOpen(false)}>
              <a href="/about">About</a>
              <a href="/contribute">Contribute</a>
              <a href="/how-it-works">How it works</a>
              <a href="/magna-carta">The Magna Carta</a>
              <div className="tr-menu-foot">
                Terraveler — a Vitruvyan EOOD company
                <br />
                <a href="mailto:dbaldoni@gmail.com">contact</a> ·{" "}
                <a href="https://vitruvyan.com" target="_blank" rel="noreferrer">vitruvyan.com</a>
              </div>
            </div>
          )}
        </div>
        <button className="tr-btn" onClick={() => setAcctOpen(true)} title="Account" aria-label="Account">
          👤
        </button>
      </div>
      <AccountPanel open={acctOpen} onClose={() => setAcctOpen(false)} />

      {/* World-events strip: dots always, words only when there is something to say. */}
      {events.length > 0 && (
      <div
        className="world-strip"
        onMouseEnter={() => setStripHover(true)}
        onMouseLeave={() => setStripHover(false)}
      >
        <div className="ws-kicker">Meanwhile in the world</div>
        <div className="wt-track">
          {events.map((ev) => (
            <button
              key={ev.title}
              className={`wt-dot cat-${ev.category} ${
                worldNow && ev.title === worldNow.title ? "active" : ""
              }`}
              style={{ left: `${pctOf(ev.time)}%` }}
              title={`${ev.date} · ${ev.title}`}
              aria-label={ev.title}
              onClick={() => {
                setPlaying(false);
                setT(ev.time);
              }}
            />
          ))}
          <div className="wt-playhead" style={{ left: `${pct}%` }} />
        </div>
        {worldNow && (stripHover || t - worldNow.time < 45 * DAY) && (
          <div className="ws-card">
            <strong>{worldNow.title}</strong> — {worldNow.blurb}{" "}
            {worldNow.source_url && (
              <a href={worldNow.source_url} target="_blank" rel="noreferrer" className="wt-src">
                source
              </a>
            )}
          </div>
        )}
      </div>
      )}

      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        <div className="hist-note">
          World c.&nbsp;1715 (nearest to the voyage) — great powers coloured; open the
          Cartographer lens for the key. A reconstruction; precision varies.
        </div>

        {current && panelOpen && (
          <DraggableWindow title={panelTitle} onClose={() => setPanelOpen(false)}>
            {lens === "carto" ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--brass)", letterSpacing: "0.08em" }}>
                    Map key
                  </span>
                  <span className="conf-badge">c. 1715</span>
                </div>
                <h2 style={{ margin: "4px 0 6px", fontSize: "1.3rem" }}>The great powers of the era</h2>
                <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-soft)", margin: "0 0 10px" }}>
                  Nearest reconstruction to the 1766 voyage. Colours mark the era&rsquo;s
                  great powers — European and Asian; most of the globe was still
                  independent states and peoples.
                </p>
                <div className="legend">
                  {EMPIRE_COLORS.map(([name, color]) => (
                    <div className="legend-row" key={name}>
                      <span className="legend-sw" style={{ background: color }} />
                      <span>{name}</span>
                    </div>
                  ))}
                  <div className="legend-row">
                    <span className="legend-sw" style={{ background: OTHER_COLOR }} />
                    <span>Independent states &amp; peoples</span>
                  </div>
                </div>
                <label className="hist-toggle">
                  <input
                    type="checkbox"
                    checked={showHist}
                    onChange={(e) => setShowHist(e.target.checked)}
                  />
                  Show period borders &amp; territories
                </label>
              </>
            ) : (
              <>
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
              </>
            )}
          </DraggableWindow>
        )}
      </div>

      <div className="transport-bar">
        <button className="play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div style={{ minWidth: 150 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem" }}>{dateLabel}</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{placeName ? `Off ${placeName}` : ""}</div>
        </div>
        <div className="voyage-track">
          <div className="vt-ticks">
            {legs.map((l) => (
              <button
                key={l.wp.id}
                className="vt-tick"
                style={{ left: `${pctOf(l.arrival)}%` }}
                title={l.wp.place_historical ?? l.wp.place_modern ?? "landfall"}
                aria-label={l.wp.place_historical ?? l.wp.place_modern ?? "landfall"}
                onClick={() => {
                  setPlaying(false);
                  openLogRef.current(l.arrival);
                }}
              />
            ))}
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
            style={{ width: "100%", backgroundSize: `${pct}% 100%` }}
            aria-label="Voyage timeline"
          />
        </div>
        <label className="autopause-toggle">
          <input
            type="checkbox"
            checked={autopause}
            onChange={(e) => setAutopause(e.target.checked)}
          />
          Pause at each stop &amp; event
        </label>
      </div>
    </div>
  );
}
