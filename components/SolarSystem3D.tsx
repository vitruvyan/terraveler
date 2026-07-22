"use client";

/**
 * SolarSystem3D — the immersive three.js orrery for the Voyager 2 space
 * voyage. Same prop contract as components/SolarSystemMap.tsx (the flat SVG
 * orrery, which this component falls back to when WebGL is unavailable),
 * plus `t`, `cameraMode` and an optional `onPlanetClick`/`onCameraModeChange`.
 *
 * Rendering approach — bloom-lit Sun via EffectComposer + UnrealBloomPass,
 * hover highlight via OutlinePass, Phong-shaded planets, an alpha-mapped
 * Saturn ring, and a slowly-orbiting cinematic follow-camera — is adapted
 * from N3rson/Solar-System-3D (MIT license) and re-typed into this app's
 * React/TypeScript codebase, driven by this app's own time/motion data
 * instead of that project's static demo scene. See
 * public/textures/CREDITS.md for full texture + rendering credits.
 *
 * Vanilla three.js (NOT react-three-fiber): the scene is built exactly once,
 * inside a single mount-effect. Every prop that changes over the component's
 * life (t, scale, showOrbits, showLabels, activeArrival, cameraMode, the
 * path arrays, ...) is written into `propsRef` on every render and read back
 * inside the rAF loop — so prop changes never tear down or rebuild the
 * scene, they just change what the next frame draws.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import SolarSystemMap from "@/components/SolarSystemMap";
import {
  CENTER,
  R_SUN,
  HELIOPAUSE_AU,
  REF_PLANETS,
  auToScreen,
  type ScaleMode,
  type MilestonePoint,
} from "@/lib/orrery-scale";
import { ALL_PLANETS, planetPositionAu, type PlanetName } from "@/lib/planet-ephemeris";

export type CameraMode = "cinematic" | "free";

type Props = {
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
  /** Scrubber time (ms, same axis as everywhere else in the app). */
  t: number;
  /** Cinematic auto-follow vs. free OrbitControls look-around. */
  cameraMode: CameraMode;
  /** Optional: click a planet mesh (schematic 8-planet ephemeris, not a waypoint). */
  onPlanetClick?: (name: string) => void;
  /**
   * Optional: fires when the camera mode changes for a reason the parent
   * didn't ask for — the user dragged (cinematic -> free), or playback
   * started / ~6s passed idle in free-look (free -> cinematic). Not in the
   * literal spec prop list; added because the spec's own handoff rules
   * ("cinematic->free on drag", "free->cinematic on play or ~6s idle")
   * can't keep the Orrery lens toggle in sync without it. See report.
   */
  onCameraModeChange?: (mode: CameraMode) => void;
  /**
   * Optional: is the transport-bar scrubber currently auto-advancing?
   * Also not in the literal spec prop list, added for the same reason as
   * onCameraModeChange — "free -> cinematic on play" needs to know when
   * play starts. Safe to omit (handoff just falls back to idle-only).
   */
  playing?: boolean;
};

// --- Visual tuning (schematic — NOT physically to scale; see comments) ----

// Reuse the flat map's Sun radius so the two renderers read as "the same
// scale" at a glance.
const SUN_VISUAL_RADIUS = R_SUN;

// Schematic planet sizes for visibility — like REF_PLANETS' small dot
// markers on the flat map, these are NOT on the same physical scale as the
// (honestly log/linear-projected) orbit distances. Nothing at true 1:1
// size-vs-distance scale would be visible on one screen at once.
const PLANET_VISUAL_RADII: Record<PlanetName, number> = {
  mercury: 1.4,
  venus: 2.1,
  earth: 2.2,
  mars: 1.7,
  jupiter: 7.2,
  saturn: 6.2,
  uranus: 4.3,
  neptune: 4.2,
};

const TEXTURE_BASE = "/textures/";
const TEXTURE_FILES: Partial<Record<PlanetName | "sun" | "saturn_ring", string>> = {
  sun: "2k_sun.jpg",
  mercury: "2k_mercury.jpg",
  venus: "2k_venus_surface.jpg",
  earth: "2k_earth_daymap.jpg",
  mars: "2k_mars.jpg",
  jupiter: "2k_jupiter.jpg",
  saturn: "2k_saturn.jpg",
  saturn_ring: "2k_saturn_ring_alpha.png",
  uranus: "2k_uranus.jpg",
  neptune: "2k_neptune.jpg",
};

// --- Camera tuning ---------------------------------------------------------
const CRUISE_DISTANCE = 65;
const HERO_DISTANCE = 16;
const CRUISE_ELEVATION = THREE.MathUtils.degToRad(22);
const HERO_ELEVATION = THREE.MathUtils.degToRad(30);
const HERO_AZIMUTH_OFFSET = THREE.MathUtils.degToRad(35);
const AZIMUTH_DRIFT_PERIOD_MS = 90_000; // ~360deg / 90s, within the 80-100s ask
const MAX_ANGULAR_SPEED = 0.9; // rad/s, clamps azimuth/elevation pursuit (anti-nausea)
const MAX_DISTANCE_RATE = 60; // world units/s, clamps zoom on top of the tau smoothing
const TARGET_TAU = 0.25; // s, fast — the look-at point eases toward the live probe
const DISTANCE_TAU = 1.2; // s, slow — zoom eases toward its proximity-driven target
const PROXIMITY_WINDOW_MS = 60 * 86_400_000; // 60 days either side of a flyby
const IDLE_TIMEOUT_MS = 6000;
const DRAG_THRESHOLD_PX = 6;
const FOCUS_OVERRIDE_MS = 3000; // planet-click zoom-tween hold time
const FOCUS_OVERRIDE_DISTANCE = 22;
// Reduced-motion: a fixed, gentle offset — only the look-at target eases.
const REDUCED_AZIMUTH = THREE.MathUtils.degToRad(35);
const REDUCED_ELEVATION = THREE.MathUtils.degToRad(24);
const REDUCED_DISTANCE = 45;

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

function expSmooth(current: number, target: number, dtSec: number, tau: number): number {
  const a = tau > 0 ? 1 - Math.exp(-dtSec / tau) : 1;
  return current + (target - current) * a;
}

function smoothstepUnit(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function shortestAngleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  const d = shortestAngleDelta(current, target);
  if (Math.abs(d) <= maxDelta) return current + d;
  return current + Math.sign(d) * maxDelta;
}

function lerpAngleShortest(a: number, b: number, t: number): number {
  return a + shortestAngleDelta(a, b) * t;
}

function clampDelta(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (d > maxDelta) return current + maxDelta;
  if (d < -maxDelta) return current - maxDelta;
  return target;
}

/** True heliocentric AU-plane -> three.js world space (y=0, the ecliptic
 *  plane). Routes through the SAME auToScreen the flat map + ephemeris use,
 *  just re-centered from SVG pixel-space to a world origin at the Sun, so
 *  every renderer agrees on where everything is for a given scale. */
function auPointToWorld(xAu: number, yAu: number, scale: ScaleMode, out = new THREE.Vector3()): THREE.Vector3 {
  const p = auToScreen(xAu, yAu, scale);
  out.set(p.x - CENTER, 0, p.y - CENTER);
  return out;
}

/** Standard fix-up for THREE.RingGeometry so a radial alpha-strip texture
 *  (like Solar System Scope's saturn ring map) maps correctly instead of the
 *  default UVs, which run 0-1 per-vertex-angle and smear the strip radially. */
function fixRingUVs(geometry: THREE.RingGeometry, innerRadius: number, outerRadius: number): void {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const u = (v3.length() - innerRadius) / (outerRadius - innerRadius);
    uv.setXY(i, THREE.MathUtils.clamp(u, 0, 1), 1);
  }
  uv.needsUpdate = true;
}

function sphericalFromCamera(camPos: THREE.Vector3, target: THREE.Vector3) {
  const dx = camPos.x - target.x;
  const dy = camPos.y - target.y;
  const dz = camPos.z - target.z;
  const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
  const azimuth = Math.atan2(dz, dx);
  const elevation = Math.asin(THREE.MathUtils.clamp(dy / distance, -1, 1));
  return { distance, azimuth, elevation };
}

function applySpherical(camera: THREE.PerspectiveCamera, target: THREE.Vector3, distance: number, azimuth: number, elevation: number) {
  const cosEl = Math.cos(elevation);
  camera.position.set(
    target.x + distance * cosEl * Math.cos(azimuth),
    target.y + distance * Math.sin(elevation),
    target.z + distance * cosEl * Math.sin(azimuth)
  );
  camera.lookAt(target);
}

export default function SolarSystem3D(props: Props) {
  // Only the props the flat-SVG fallback JSX needs (below) or the one-time
  // scene setup needs are pulled out as locals; everything else (t, scale,
  // cameraMode, showOrbits, ...) is read every frame from `propsRef` inside
  // the mount-effect, so it's deliberately NOT destructured here.
  const { fullPath, donePath, shipAu, waypoints, activeArrival, scale, showOrbits, showLabels, onWaypointClick } =
    props;

  const mountRef = useRef<HTMLDivElement>(null);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  // Every prop the render loop needs, mirrored into a ref every render so
  // the mount-effect (which runs once) always reads the latest values.
  const propsRef = useRef(props);
  propsRef.current = props;

  // The render-on-demand loop below skips rendering when paused and idle
  // (perf). But if the user scrubs the timeline, or flips scale/orbits/
  // labels/camera-mode, while paused, that's a prop change with no
  // hover/drag/playing to keep the loop "active" — without this, the scene
  // would freeze on whatever last rendered. `wakeRef` lets the loop be told
  // "something changed, render one more frame," and the deps-less effect
  // below fires it after every render (i.e. whenever any prop changes).
  const wakeRef = useRef<() => void>(() => {});
  useEffect(() => {
    wakeRef.current();
  });

  useEffect(() => {
    setWebglOk(detectWebGL());
  }, []);

  useEffect(() => {
    if (webglOk !== true) return;
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;

    // --- environment ---------------------------------------------------
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    const lowPower = isTouch || (navigator.hardwareConcurrency ?? 8) <= 4;
    const reducedMotionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let prefersReducedMotion = reducedMotionMq.matches;
    const onReducedMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    reducedMotionMq.addEventListener("change", onReducedMotionChange);

    const widthOf = () => Math.max(1, mount.clientWidth || window.innerWidth);
    const heightOf = () => Math.max(1, mount.clientHeight || window.innerHeight);

    // --- renderer / scene / camera --------------------------------------
    const renderer = new THREE.WebGLRenderer({
      antialias: !lowPower,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(widthOf(), heightOf());
    renderer.setClearColor(0x000000, 0); // transparent — the CSS starfield (.space::before) shows through
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    // renderer.setSize() above already sets explicit pixel width/height
    // matching the mount container exactly (and keeps doing so on every
    // resize via the ResizeObserver below) — position:absolute just anchors
    // that canvas to the container's top-left corner.
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.left = "0";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, widthOf() / heightOf(), 0.05, 4000);
    camera.position.set(CRUISE_DISTANCE * 0.7, 25, CRUISE_DISTANCE * 0.7);
    camera.lookAt(0, 0, 0);

    // --- lighting --------------------------------------------------------
    scene.add(new THREE.AmbientLight(0x222222, 6));
    const sunLight = new THREE.PointLight(0xffffff, 3, 0, 0.15);
    scene.add(sunLight);

    // --- Sun ---------------------------------------------------------------
    const sunGeo = new THREE.SphereGeometry(SUN_VISUAL_RADIUS, 48, 32);
    // Color pushed above 1.0 on purpose: with the HalfFloat composer target
    // below, this is what UnrealBloomPass's luminance threshold picks up.
    const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffdf7e).multiplyScalar(2.4) });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sunMesh);

    // --- planets -----------------------------------------------------------
    interface PlanetEntry {
      key: PlanetName;
      displayName: string;
      pivot: THREE.Group;
      mesh: THREE.Mesh;
      mat: THREE.MeshPhongMaterial;
      spinSpeed: number;
    }
    const planetEntries: PlanetEntry[] = [];
    const planetHitObjects: THREE.Object3D[] = [];

    ALL_PLANETS.forEach((key, i) => {
      const ref = REF_PLANETS.find((p) => p.name.toLowerCase() === key) ?? REF_PLANETS[i];
      const radius = PLANET_VISUAL_RADII[key];
      const geo = new THREE.SphereGeometry(radius, 32, 24);
      const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(ref.color), shininess: 8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { kind: "planet", name: ref.name };
      const pivot = new THREE.Group();
      pivot.add(mesh);
      scene.add(pivot);
      planetHitObjects.push(mesh);

      if (key === "saturn") {
        const inner = radius * 1.35;
        const outer = radius * 2.4;
        const ringGeo = new THREE.RingGeometry(inner, outer, 64, 1);
        fixRingUVs(ringGeo, inner, outer);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xc9b896,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2; // lie flat on the y=0 ecliptic plane
        ring.userData = { kind: "saturnRing" };
        mesh.add(ring);
      }

      // Decorative axial spin only — NOT physically-scaled rotation periods.
      const spinSpeed = (0.12 + i * 0.05) * (i % 2 === 0 ? 1 : -1);
      planetEntries.push({ key, displayName: ref.name, pivot, mesh, mat, spinSpeed });
    });

    // --- orbit rings (Sun-centered circles, rebuilt only when scale changes) ---
    const orbitRingGroup = new THREE.Group();
    scene.add(orbitRingGroup);
    let lastRingScale: ScaleMode | null = null;
    function rebuildOrbitRings(scaleMode: ScaleMode) {
      while (orbitRingGroup.children.length) {
        const child = orbitRingGroup.children.pop()!;
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
      const SEG = 128;
      const buildCircle = (rAu: number, color: number, opacity: number) => {
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s <= SEG; s++) {
          const a = (s / SEG) * Math.PI * 2;
          pts.push(auPointToWorld(rAu * Math.cos(a), rAu * Math.sin(a), scaleMode));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        return new THREE.Line(geo, mat);
      };
      for (const p of REF_PLANETS) orbitRingGroup.add(buildCircle(p.r_au, 0x8fa3d6, 0.28));
      orbitRingGroup.add(buildCircle(HELIOPAUSE_AU, 0xd8b25c, 0.4));
      lastRingScale = scaleMode;
    }
    rebuildOrbitRings(propsRef.current.scale);

    // --- trajectory lines (full dashed route + solid traveled route) -------
    const fullLineMat = new THREE.LineDashedMaterial({
      color: 0x6fd1ff,
      transparent: true,
      opacity: 0.35,
      dashSize: 2,
      gapSize: 1.4,
    });
    const doneLineMat = new THREE.LineBasicMaterial({ color: 0x6fd1ff });
    let fullLine = new THREE.Line(new THREE.BufferGeometry(), fullLineMat);
    let doneLine = new THREE.Line(new THREE.BufferGeometry(), doneLineMat);
    scene.add(fullLine, doneLine);
    function rebuildPathLine(line: THREE.Line, coords: [number, number][], scaleMode: ScaleMode, dashed: boolean) {
      const pts = coords.map(([x, y]) => auPointToWorld(x, y, scaleMode));
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      if (dashed) line.computeLineDistances();
    }

    // --- waypoint markers (real flybys + heliopause) ------------------------
    interface WaypointEntry {
      mp: MilestonePoint;
      mesh: THREE.Mesh;
    }
    const waypointEntries: WaypointEntry[] = [];
    const waypointHitObjects: THREE.Object3D[] = [];
    const waypointGroup = new THREE.Group();
    scene.add(waypointGroup);
    for (const mp of waypoints) {
      const hasMedia = !!mp.wp.media && mp.wp.media.length > 0;
      const geo = new THREE.SphereGeometry(hasMedia ? 1.6 : 1.1, 16, 12);
      const color = mp.wp.confidence === "approximate" ? 0xc9a24a : 0xd8b25c;
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { kind: "waypoint", arrival: mp.arrival };
      waypointGroup.add(mesh);
      waypointHitObjects.push(mesh);
      waypointEntries.push({ mp, mesh });
    }

    // --- probe marker --------------------------------------------------------
    const probeGeo = new THREE.ConeGeometry(1.1, 3.6, 8);
    // Object3D.lookAt() always aligns local -Z to the target, so rotate the
    // cone's default apex (+Y) to point along local -Z to match it.
    probeGeo.rotateX(-Math.PI / 2);
    const probeMat = new THREE.MeshBasicMaterial({ color: 0x6fd1ff });
    const probeMesh = new THREE.Mesh(probeGeo, probeMat);
    scene.add(probeMesh);
    const prevProbeWorld = new THREE.Vector3();
    let havePrevProbe = false;

    // --- postprocessing: bloom + hover outline -------------------------------
    const renderTarget = new THREE.WebGLRenderTarget(widthOf(), heightOf(), { type: THREE.HalfFloatType });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(widthOf(), heightOf());
    composer.addPass(new RenderPass(scene, camera));

    const bloomRes = lowPower
      ? new THREE.Vector2(Math.floor(widthOf() / 2), Math.floor(heightOf() / 2))
      : new THREE.Vector2(widthOf(), heightOf());
    const bloomPass = new UnrealBloomPass(bloomRes, 1.1, 0.9, 1.0);
    composer.addPass(bloomPass);

    const outlineEnabled = !lowPower;
    let outlinePass: OutlinePass | null = null;
    if (outlineEnabled) {
      outlinePass = new OutlinePass(new THREE.Vector2(widthOf(), heightOf()), scene, camera);
      outlinePass.edgeStrength = 4;
      outlinePass.edgeGlow = 0.5;
      outlinePass.edgeThickness = 1.5;
      outlinePass.visibleEdgeColor.set(0xd8b25c);
      outlinePass.hiddenEdgeColor.set(0x2a2f3d);
      composer.addPass(outlinePass);
    }

    const outputPass = new OutputPass();
    composer.addPass(outputPass);
    composer.passes[composer.passes.length - 1].renderToScreen = true;

    // --- DOM label overlay (planets + waypoints; imperative, not React state) ---
    const labelLayer = document.createElement("div");
    labelLayer.style.position = "absolute";
    labelLayer.style.inset = "0";
    labelLayer.style.overflow = "hidden";
    labelLayer.style.pointerEvents = "none";
    mount.appendChild(labelLayer);

    function makeLabel(text: string, isHelio: boolean): HTMLDivElement {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.top = "0";
      el.style.transform = "translate(-50%, -140%)";
      el.style.font = "9px var(--font-body, sans-serif)";
      el.style.letterSpacing = "0.02em";
      el.style.color = isHelio ? "#d8b25c" : "#8b96b3";
      el.style.textShadow = "0 1px 2px rgba(0,0,0,0.8)";
      el.style.whiteSpace = "nowrap";
      el.style.willChange = "transform";
      labelLayer.appendChild(el);
      return el;
    }
    const planetLabels = planetEntries.map((p) => makeLabel(p.displayName, false));
    const waypointLabels = waypointEntries.map((w) => makeLabel(w.mp.wp.body, w.mp.wp.body.startsWith("Heliopause")));

    const projectScratch = new THREE.Vector3();
    function positionLabel(el: HTMLDivElement, worldPos: THREE.Vector3, w: number, h: number) {
      projectScratch.copy(worldPos).project(camera);
      if (projectScratch.z > 1) {
        el.style.display = "none";
        return;
      }
      const x = (projectScratch.x * 0.5 + 0.5) * w;
      const y = (-projectScratch.y * 0.5 + 0.5) * h;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      el.style.transform = `translate(-50%, -140%) translate(${x}px, ${y}px)`;
    }

    // --- lazy texture loading: colored spheres first, textures swapped in ---
    function scheduleIdle(fn: () => void) {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
      if (ric) ric(fn);
      else setTimeout(fn, 50);
    }
    scheduleIdle(() => {
      if (disposed) return;
      const loader = new THREE.TextureLoader();
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const loadColor = (url: string, onDone: (tex: THREE.Texture) => void) => {
        loader.load(
          url,
          (tex) => {
            if (disposed) {
              tex.dispose();
              return;
            }
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = maxAniso;
            onDone(tex);
          },
          undefined,
          () => {
            /* texture missing/blocked — keep the flat schematic color, no crash */
          }
        );
      };
      const sunFile = TEXTURE_FILES.sun;
      if (sunFile) {
        loadColor(TEXTURE_BASE + sunFile, (tex) => {
          sunMat.map = tex;
          sunMat.needsUpdate = true;
        });
      }
      for (const entry of planetEntries) {
        const file = TEXTURE_FILES[entry.key];
        if (!file) continue;
        loadColor(TEXTURE_BASE + file, (tex) => {
          entry.mat.map = tex;
          entry.mat.needsUpdate = true;
        });
      }
      const ringFile = TEXTURE_FILES.saturn_ring;
      const saturnEntry = planetEntries.find((p) => p.key === "saturn");
      const ringMesh = saturnEntry?.mesh.children.find((c) => c.userData?.kind === "saturnRing") as
        | THREE.Mesh
        | undefined;
      if (ringFile && ringMesh) {
        loader.load(
          TEXTURE_BASE + ringFile,
          (tex) => {
            if (disposed) {
              tex.dispose();
              return;
            }
            const mat = ringMesh.material as THREE.MeshBasicMaterial;
            mat.alphaMap = tex;
            mat.needsUpdate = true;
          },
          undefined,
          () => {}
        );
      }
    });

    // --- camera state (plain closure vars — not React state; this whole loop
    // lives inside one effect that owns them for its lifetime) ----------------
    let effectiveMode: CameraMode = propsRef.current.cameraMode;
    const targetVec = new THREE.Vector3(0, 0, 0);
    let distance = CRUISE_DISTANCE;
    let azimuth = Math.atan2(camera.position.z, camera.position.x);
    let elevation = CRUISE_ELEVATION;
    let azimuthDrift = azimuth;
    let focusOverride: { pos: THREE.Vector3; until: number } | null = null;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.75;
    controls.enabled = false;
    controls.target.copy(targetVec);
    controls.update();

    function switchToFree() {
      if (effectiveMode === "free") return;
      controls.target.copy(targetVec);
      controls.update();
      controls.enabled = true;
      effectiveMode = "free";
      propsRef.current.onCameraModeChange?.("free");
    }
    function switchToCinematic() {
      if (effectiveMode === "cinematic") return;
      const sph = sphericalFromCamera(camera.position, controls.target);
      distance = sph.distance;
      azimuth = sph.azimuth;
      elevation = sph.elevation;
      azimuthDrift = sph.azimuth;
      targetVec.copy(controls.target);
      controls.enabled = false;
      effectiveMode = "cinematic";
      propsRef.current.onCameraModeChange?.("cinematic");
    }

    // --- pointer interaction: drag threshold, click-to-select, hover --------
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDown: { x: number; y: number } | null = null;
    let wasDrag = false;
    let lastInteraction = performance.now();
    let hovered: THREE.Object3D | null = null;

    function setPointerNdc(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function hitTest(): THREE.Intersection[] {
      raycaster.setFromCamera(pointerNdc, camera);
      return raycaster.intersectObjects([...planetHitObjects, ...waypointHitObjects], false);
    }

    function onPointerDown(e: PointerEvent) {
      pointerDown = { x: e.clientX, y: e.clientY };
      wasDrag = false;
      lastInteraction = performance.now();
    }
    function onPointerMove(e: PointerEvent) {
      lastInteraction = performance.now();
      if (pointerDown) {
        const dx = e.clientX - pointerDown.x;
        const dy = e.clientY - pointerDown.y;
        if (!wasDrag && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          wasDrag = true;
          if (effectiveMode === "cinematic") switchToFree();
        }
      }
      if (!wasDrag) {
        setPointerNdc(e);
        const hits = hitTest();
        const next = hits.length ? hits[0].object : null;
        if (next !== hovered) {
          hovered = next;
          if (outlinePass) outlinePass.selectedObjects = hovered ? [hovered] : [];
          renderer.domElement.style.cursor = hovered ? "pointer" : "";
        }
      }
    }
    function onPointerUp(e: PointerEvent) {
      lastInteraction = performance.now();
      const drag = wasDrag;
      pointerDown = null;
      wasDrag = false;
      if (drag) return;
      setPointerNdc(e);
      const hits = hitTest();
      if (!hits.length) return;
      const obj = hits[0].object;
      if (obj.userData?.kind === "waypoint") {
        propsRef.current.onWaypointClick(obj.userData.arrival as number);
      } else if (obj.userData?.kind === "planet") {
        const name = obj.userData.name as string;
        propsRef.current.onPlanetClick?.(name);
        if (effectiveMode === "cinematic") {
          const entry = planetEntries.find((p) => p.displayName === name);
          if (entry) focusOverride = { pos: entry.pivot.position.clone(), until: performance.now() + FOCUS_OVERRIDE_MS };
        }
      }
    }
    function onPointerLeave() {
      if (hovered) {
        hovered = null;
        if (outlinePass) outlinePass.selectedObjects = [];
        renderer.domElement.style.cursor = "";
      }
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("wheel", () => (lastInteraction = performance.now()), { passive: true });

    // --- resize ---------------------------------------------------------------
    const resizeObserver = new ResizeObserver(() => {
      const w = widthOf();
      const h = heightOf();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      if (outlinePass) outlinePass.setSize(w, h);
      bloomPass.setSize(lowPower ? Math.floor(w / 2) : w, lowPower ? Math.floor(h / 2) : h);
    });
    resizeObserver.observe(mount);

    // --- visibility: pause rAF entirely while the tab is hidden -----------------
    let rafId = 0;
    let lastTime = performance.now();
    let needsRender = true;
    wakeRef.current = () => {
      needsRender = true;
    };
    function onVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else {
        lastTime = performance.now();
        rafId = requestAnimationFrame(loop);
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    function nearestFlybyProximity(tMs: number, mps: MilestonePoint[]): { p: number; nearest: MilestonePoint | null } {
      let best = Infinity;
      let nearest: MilestonePoint | null = null;
      for (const mp of mps) {
        const d = Math.abs(tMs - mp.arrival);
        if (d < best) {
          best = d;
          nearest = mp;
        }
      }
      if (!nearest) return { p: 0, nearest: null };
      return { p: THREE.MathUtils.clamp(1 - best / PROXIMITY_WINDOW_MS, 0, 1), nearest };
    }

    function loop(now: number) {
      rafId = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dtMsRaw = now - lastTime;
      lastTime = now;
      const dtMs = Math.min(dtMsRaw, 100); // clamp big gaps (tab was throttled, etc.)
      const dtSec = dtMs / 1000;

      const p = propsRef.current;
      const active = !!p.playing || pointerDown !== null || hovered !== null || needsRender || effectiveMode === "free";
      if (!active) return;
      needsRender = false;

      // Honor an explicit toggle from the parent (Orrery lens button) unless
      // the user is mid-drag (drag always wins locally until pointerup).
      if (p.cameraMode !== effectiveMode && !pointerDown) {
        if (p.cameraMode === "free") switchToFree();
        else switchToCinematic();
      }

      // --- orbit rings: rebuild only when the scale toggle actually changes ---
      if (p.scale !== lastRingScale) rebuildOrbitRings(p.scale);

      // --- trajectory lines ---
      rebuildPathLine(fullLine, p.fullPath, p.scale, true);
      rebuildPathLine(doneLine, p.donePath, p.scale, false);
      fullLine.visible = p.fullPath.length > 1;
      doneLine.visible = p.donePath.length > 1;

      orbitRingGroup.visible = p.showOrbits;

      // --- planets: live ephemeris position + decorative spin ---
      for (const entry of planetEntries) {
        const auPos = planetPositionAu(entry.key, p.t);
        auPointToWorld(auPos.x, auPos.y, p.scale, entry.pivot.position);
        entry.mesh.rotation.y += entry.spinSpeed * dtSec;
      }

      // --- waypoint markers ---
      for (const we of waypointEntries) {
        auPointToWorld(we.mp.x, we.mp.y, p.scale, we.mesh.position);
        const isActive = we.mp.arrival === p.activeArrival;
        const mat = we.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = isActive ? 1 : 0.85;
        we.mesh.scale.setScalar(isActive ? 1.35 : 1);
      }

      // --- probe marker + heading ---
      const probeWorld = auPointToWorld(p.shipAu.x, p.shipAu.y, p.scale);
      if (havePrevProbe && probeWorld.distanceTo(prevProbeWorld) > 1e-5) {
        const lookTarget = probeWorld.clone().add(probeWorld.clone().sub(prevProbeWorld));
        probeMesh.position.copy(probeWorld);
        probeMesh.lookAt(lookTarget);
      } else {
        probeMesh.position.copy(probeWorld);
      }
      prevProbeWorld.copy(probeWorld);
      havePrevProbe = true;

      // --- camera ---
      const w = widthOf();
      const h = heightOf();
      if (effectiveMode === "free") {
        controls.update();
      } else if (prefersReducedMotion) {
        targetVec.x = expSmooth(targetVec.x, probeWorld.x, dtSec, TARGET_TAU);
        targetVec.y = expSmooth(targetVec.y, probeWorld.y, dtSec, TARGET_TAU);
        targetVec.z = expSmooth(targetVec.z, probeWorld.z, dtSec, TARGET_TAU);
        applySpherical(camera, targetVec, REDUCED_DISTANCE, REDUCED_AZIMUTH, REDUCED_ELEVATION);
      } else {
        let desiredTarget = probeWorld;
        let desiredDistance = CRUISE_DISTANCE;
        let desiredElevation = CRUISE_ELEVATION;
        let desiredAzimuth = azimuthDrift;

        if (focusOverride && focusOverride.until > now) {
          desiredTarget = focusOverride.pos;
          desiredDistance = FOCUS_OVERRIDE_DISTANCE;
        } else {
          focusOverride = null;
          const { p: proximity, nearest } = nearestFlybyProximity(p.t, p.waypoints);
          const pEase = smoothstepUnit(proximity);
          desiredDistance = THREE.MathUtils.lerp(CRUISE_DISTANCE, HERO_DISTANCE, pEase);
          desiredElevation = THREE.MathUtils.lerp(CRUISE_ELEVATION, HERO_ELEVATION, pEase);
          azimuthDrift += ((Math.PI * 2) / AZIMUTH_DRIFT_PERIOD_MS) * dtMs;
          azimuthDrift %= Math.PI * 2;
          if (nearest && pEase > 0.001) {
            const nearestWorld = auPointToWorld(nearest.x, nearest.y, p.scale);
            const dirAz = Math.atan2(nearestWorld.z - probeWorld.z, nearestWorld.x - probeWorld.x);
            desiredAzimuth = lerpAngleShortest(azimuthDrift, dirAz + HERO_AZIMUTH_OFFSET, pEase);
          } else {
            desiredAzimuth = azimuthDrift;
          }
        }

        targetVec.x = expSmooth(targetVec.x, desiredTarget.x, dtSec, TARGET_TAU);
        targetVec.y = expSmooth(targetVec.y, desiredTarget.y, dtSec, TARGET_TAU);
        targetVec.z = expSmooth(targetVec.z, desiredTarget.z, dtSec, TARGET_TAU);

        const smoothedDistance = expSmooth(distance, desiredDistance, dtSec, DISTANCE_TAU);
        distance = clampDelta(distance, smoothedDistance, MAX_DISTANCE_RATE * dtSec);

        const maxAngleStep = MAX_ANGULAR_SPEED * dtSec;
        azimuth = moveTowardsAngle(azimuth, desiredAzimuth, maxAngleStep);
        elevation = moveTowardsAngle(elevation, desiredElevation, maxAngleStep);

        applySpherical(camera, targetVec, distance, azimuth, elevation);
      }

      // --- idle / play handoff back to cinematic ---
      if (effectiveMode === "free" && !pointerDown) {
        const idleFor = now - lastInteraction;
        if (p.playing || idleFor > IDLE_TIMEOUT_MS) switchToCinematic();
      }

      // --- labels ---
      if (p.showLabels) {
        planetEntries.forEach((entry, i) => positionLabel(planetLabels[i], entry.pivot.position, w, h));
        waypointEntries.forEach((we, i) => positionLabel(waypointLabels[i], we.mesh.position, w, h));
      } else {
        planetLabels.forEach((el) => (el.style.display = "none"));
        waypointLabels.forEach((el) => (el.style.display = "none"));
      }

      composer.render();
    }
    rafId = requestAnimationFrame(loop);

    // --- full teardown ------------------------------------------------------
    return () => {
      disposed = true;
      wakeRef.current = () => {};
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionMq.removeEventListener("change", onReducedMotionChange);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);

      controls.dispose();
      composer.dispose();
      renderTarget.dispose();

      // sunMesh, probeMesh, every planet/waypoint mesh, and every orbit-ring /
      // path Line are all reachable from `scene` at this point, so a single
      // traversal disposes every geometry, material, and any texture loaded
      // into it (map/alphaMap) — no need to dispose them individually above.
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry?.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (!m) continue;
            const anyMat = m as THREE.MeshBasicMaterial & THREE.MeshPhongMaterial;
            anyMat.map?.dispose();
            anyMat.alphaMap?.dispose();
            m.dispose();
          }
        }
      });

      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      if (labelLayer.parentNode === mount) mount.removeChild(labelLayer);
    };
    // Deliberately empty: the scene is built once; every prop is read back
    // out of propsRef inside the loop above, every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglOk]);

  if (webglOk === false) {
    // No WebGL — retained flat SVG fallback, unchanged behavior.
    return (
      <SolarSystemMap
        fullPath={fullPath}
        donePath={donePath}
        shipAu={shipAu}
        waypoints={waypoints}
        activeArrival={activeArrival}
        scale={scale}
        showOrbits={showOrbits}
        showLabels={showLabels}
        onWaypointClick={onWaypointClick}
      />
    );
  }

  if (webglOk === null) {
    // Feature-detecting — a cheap starfield skeleton, no canvas yet.
    return <div style={{ position: "absolute", inset: 0 }} />;
  }

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
