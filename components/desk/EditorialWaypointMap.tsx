"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { basemapStyle, collapseAttributionOnPhone } from "@/lib/basemaps";
import type { EditorialPreviewWaypoint } from "@/lib/editorialPreview";

export default function EditorialWaypointMap({ waypoints }: { waypoints: EditorialPreviewWaypoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let map: any;
    (async () => {
      const mod = await import("maplibre-gl");
      const gl: any = (mod as any).default ?? mod;
      if (cancelled || !containerRef.current || waypoints.length === 0) return;
      const routeColor = getComputedStyle(containerRef.current).getPropertyValue("--route").trim();
      map = new gl.Map({ container: containerRef.current, style: basemapStyle("earth"),
        center: [waypoints[0].longitude, waypoints[0].latitude], zoom: 2, renderWorldCopies: true });
      map.on("load", () => {
        if (!map || cancelled) return;
        collapseAttributionOnPhone(containerRef.current);
        const coordinates = waypoints.map(waypoint => [waypoint.longitude, waypoint.latitude] as [number, number]);
        if (coordinates.length > 1) {
          map.addSource("preview-route", { type: "geojson", data: { type: "Feature", properties: {},
            geometry: { type: "LineString", coordinates } } });
          map.addLayer({ id: "preview-route", type: "line", source: "preview-route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": routeColor, "line-width": 2, "line-dasharray": [2, 2] } });
        }
        const bounds = new gl.LngLatBounds();
        for (const waypoint of waypoints) {
          const coordinate: [number, number] = [waypoint.longitude, waypoint.latitude];
          bounds.extend(coordinate);
          const marker = document.createElement("button");
          marker.type = "button";
          marker.className = `preview-map-marker conf-${waypoint.confidence}`;
          marker.textContent = String(waypoint.sequence);
          marker.addEventListener("click", () => document.getElementById(`preview-waypoint-${waypoint.id}`)?.scrollIntoView({ block: "center" }));
          new gl.Marker({ element: marker }).setLngLat(coordinate).addTo(map);
          marker.setAttribute("aria-label", `Waypoint ${waypoint.sequence}: ${waypoint.place_historical}`);
        }
        if (waypoints.length === 1) map.jumpTo({ center: coordinates[0], zoom: 5 });
        else map.fitBounds(bounds, { padding: 48, maxZoom: 6, duration: 0 });
      });
    })();
    return () => { cancelled = true; if (map) map.remove(); };
  }, [waypoints]);
  return <div className="preview-map" ref={containerRef} role="region" aria-label="Map of candidate waypoints in this saved draft" />;
}
