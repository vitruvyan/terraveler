import { NextResponse } from "next/server";
import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";

export const runtime = "nodejs";

const PATH_SHAPE = /^\/[\w\-./%]{0,200}$/;   // a pathname, not a URL
const HOST_SHAPE = /^[a-z0-9.-]{1,255}$/i;

/** Records one page load. Best-effort and silent, like search's recordMiss:
 *  a reader must never see a broken page because the pageview counter is
 *  down. This writes to the VPS PostgreSQL data plane through PostgREST. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const path = typeof body?.path === "string" ? body.path.slice(0, 200) : "";
  if (!PATH_SHAPE.test(path)) return NextResponse.json({ error: "path required" }, { status: 400 });

  const rawHost = typeof body?.referrer_host === "string" ? body.referrer_host.slice(0, 255) : "";
  const referrer_host = HOST_SHAPE.test(rawHost) ? rawHost : null;

  if (POSTGREST_URL && POSTGREST_SERVICE_KEY) {
    try {
      await fetch(`${POSTGREST_URL}/rest/v1/rpc/record_page_view`, {
        method: "POST",
        headers: {
          apikey: POSTGREST_SERVICE_KEY,
          Authorization: `Bearer ${POSTGREST_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_path: path, p_referrer_host: referrer_host }),
      });
    } catch {
      /* best-effort — never fail a page load over this */
    }
  }
  return NextResponse.json({ ok: true });
}
