import { NextResponse } from "next/server";
import { reconcileAllHumanRanks } from "@/lib/rankPromotion";

/**
 * The Purser's A1 reconciliation, triggered by Vercel Cron (vercel.json)
 * rather than a VPS crontab: the logic lives in lib/rankPromotion.ts and
 * needs POSTGREST_URL/POSTGREST_SERVICE_KEY, which are configured as this
 * Vercel project's own env — not present in the VPS data-plane's .env,
 * which only carries the raw Postgres/Redis/Telegram credentials the
 * self-hosted services use directly. Running the reconciliation as a
 * Vercel Cron keeps it on the same environment its dependency already
 * lives in, instead of teaching a second host about credentials it was
 * never meant to hold.
 *
 * Vercel signs its own cron requests with `Authorization: Bearer
 * $CRON_SECRET` when CRON_SECRET is set on the project — checked here so
 * this isn't a public, unauthenticated trigger for rank recalculation.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const summary = await reconcileAllHumanRanks();
  return NextResponse.json({
    checked: summary.checked,
    failed: summary.failed,
    promotions: summary.results,
    errors: summary.errors,
  }, { status: summary.failed ? 207 : 200 });
}
