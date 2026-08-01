/* Measure the map on a phone, on a real engine.
 *
 *   node scripts/measure-phone.mjs [url] [width] [height]
 *
 * Reading the stylesheet cannot answer any of these questions. Two of the
 * findings in c5ff173 were only reachable this way: a z-index of 30 that was a
 * nought because of an ancestor, and a note eating 12.9% of the screen that
 * nobody had noticed because it looked like a caption.
 *
 * It reports four things and asserts none of them — the numbers are the point,
 * and what counts as too much is a judgement made by a person looking.
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "https://www.terraveler.com/";
const W = Number(process.argv[3] ?? 390);
const H = Number(process.argv[4] ?? 844);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36",
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
/* MapLibre builds its attribution after mount, and the edge stack measures it
   one frame later still. */
await page.waitForTimeout(3500);

/* DISMISS=1 measures the returning reader instead of the first-time one. The
   welcome cartouche is 27% of the screen on its own, so leaving it in the
   count answers a different question from the one usually being asked. */
if (process.env.DISMISS) {
  await page.locator(".welcome-x").click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

const report = await page.evaluate(({ W, H }) => {
  const OVER_MAP = ["absolute", "fixed", "sticky"];

  /* Anything that starts a new stacking scale, which is what makes a z-index
     mean something other than what it says. */
  const startsScale = (el) => {
    const s = getComputedStyle(el);
    return (
      (s.position !== "static" && s.zIndex !== "auto") ||
      s.transform !== "none" ||
      s.filter !== "none" ||
      Number(s.opacity) < 1 ||
      s.isolation === "isolate" ||
      s.mixBlendMode !== "normal" ||
      s.contain.includes("paint")
    );
  };

  const chrome = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (!OVER_MAP.includes(s.position)) continue;
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
    /* The map canvas and its wrapper are the subject, not chrome. */
    if (el.classList.contains("maplibregl-canvas") || el.querySelector("canvas")) continue;

    const trap = [];
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (startsScale(p)) trap.push(`${p.tagName.toLowerCase()}.${[...p.classList].join(".")}=${getComputedStyle(p).zIndex}`);
    }

    chrome.push({
      sel: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`.slice(0, 70),
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      z: s.zIndex,
      trappedBy: trap[0] ?? null,
      clipped:
        r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5,
    });
  }

  /* Union area by grid, so overlapping bands are not counted twice. */
  const grid = new Uint8Array(W * H);
  for (const c of chrome) {
    for (let y = Math.max(0, c.y); y < Math.min(H, c.y + c.h); y++)
      for (let x = Math.max(0, c.x); x < Math.min(W, c.x + c.w); x++) grid[y * W + x] = 1;
  }
  let covered = 0;
  for (let i = 0; i < grid.length; i++) covered += grid[i];

  /* Every pair, rather than the ones anyone thought to name. */
  const overlaps = [];
  for (let i = 0; i < chrome.length; i++)
    for (let j = i + 1; j < chrome.length; j++) {
      const a = chrome[i], b = chrome[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) {
        /* A thing inside another thing is nesting, not a collision. */
        const nested =
          (a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h) ||
          (b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h);
        if (!nested) overlaps.push({ a: a.sel, b: b.sel, area: ox * oy });
      }
    }

  /* Anything a finger has to hit. */
  const small = [];
  for (const el of document.querySelectorAll(
    'button, a, [role="button"], input, label, summary',
  )) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    if (Math.min(r.width, r.height) < 44) {
      small.push({
        sel: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`.slice(0, 60),
        w: Math.round(r.width), h: Math.round(r.height),
        label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24),
        titleOnly: !!el.getAttribute("title") && !el.getAttribute("aria-label"),
      });
    }
  }

  return { chrome, covered, overlaps, small, safe: getComputedStyle(document.documentElement).getPropertyValue("--safe-b") };
}, { W, H });

const pct = ((report.covered / (W * H)) * 100).toFixed(1);

console.log(`\n${URL}  @ ${W}x${H}\n`);
console.log(`CHROME SHARE: ${pct}%  (${report.chrome.length} positioned elements over the map)`);
console.log(`--safe-b resolves to: ${report.safe.trim() || "(empty)"}\n`);

console.log("BANDS, top to bottom:");
for (const c of [...report.chrome].sort((a, b) => a.y - b.y)) {
  const share = ((c.w * c.h) / (W * H) * 100).toFixed(1);
  console.log(
    `  ${String(c.y).padStart(4)}  ${String(c.w).padStart(3)}x${String(c.h).padStart(3)}  ` +
      `${share.padStart(4)}%  z=${String(c.z).padStart(4)}  ${c.clipped ? "CLIPPED " : ""}` +
      `${c.trappedBy ? `trapped-by ${c.trappedBy} ` : ""}${c.sel}`,
  );
}

console.log(`\nOVERLAPPING PAIRS: ${report.overlaps.length}`);
for (const o of report.overlaps.sort((a, b) => b.area - a.area).slice(0, 12)) {
  console.log(`  ${o.area}px²  ${o.a}  ×  ${o.b}`);
}

console.log(`\nUNDER ${44}px: ${report.small.length}`);
for (const s of report.small) {
  console.log(
    `  ${String(s.w).padStart(3)}x${String(s.h).padStart(3)}  ` +
      `${s.titleOnly ? "title-only " : ""}${s.sel}  ${s.label ? `“${s.label}”` : ""}`,
  );
}

await browser.close();
