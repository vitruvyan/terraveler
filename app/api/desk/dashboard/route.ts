import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { readAdminDashboard } from "@/lib/adminDashboard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  try { return NextResponse.json(await readAdminDashboard(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "The platform overview is unavailable. Retry to check its state." }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
}
