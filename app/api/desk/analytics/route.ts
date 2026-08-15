import { NextResponse } from "next/server";
import { requireEditor, sb } from "@/lib/deskAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const ROW_CAP = 20000; // truncation guard, not a real limit — see `truncated` below

/** Traffic, the same way overview reads governance data: a bounded raw fetch,
 *  reduced in JS. No true all-time count — Prefer: count=exact isn't a
 *  pattern used anywhere in this codebase and sb() doesn't expose response
 *  headers — a 30-day window answers "is traffic arriving" just as well. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  try {
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const rows: { path: string; viewed_at: string }[] = await sb(
      "GET",
      `page_views?viewed_at=gte.${cutoff}&select=path,viewed_at&order=viewed_at.desc&limit=${ROW_CAP}`,
    );

    const now = Date.now(), DAY = 86_400_000;
    const todayKey = new Date(now).toISOString().slice(0, 10);
    const sevenCutoff = now - 7 * DAY;

    let today = 0, last7 = 0;
    const byDay: Record<string, number> = {};
    const byPath: Record<string, number> = {};
    for (const r of rows) {
      const t = new Date(r.viewed_at).getTime();
      if (Number.isNaN(t)) continue;
      if (t >= sevenCutoff) last7++;
      const dayKey = r.viewed_at.slice(0, 10);
      if (dayKey === todayKey) today++;
      byDay[dayKey] = (byDay[dayKey] ?? 0) + 1;
      byPath[r.path] = (byPath[r.path] ?? 0) + 1;
    }

    // Zero-filled, oldest first: a quiet day is a finding, not a gap in the list.
    const daily = Array.from({ length: 14 }, (_, i) => {
      const key = new Date(now - (13 - i) * DAY).toISOString().slice(0, 10);
      return { day: key, n: byDay[key] ?? 0 };
    });

    const topPaths = Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, n]) => ({ path, n }));

    return NextResponse.json({
      counts: { today, last7, last30: rows.length },
      truncated: rows.length >= ROW_CAP,
      daily,
      topPaths,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
