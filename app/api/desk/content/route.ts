import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { readDeskRows } from "@/lib/deskQueue";
import { loadDeskContent } from "@/lib/deskContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only editorial catalogue. This route never approves or publishes. */
export async function GET(req: Request) {
  const auth = await requireEditor(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    return NextResponse.json(await loadDeskContent(readDeskRows));
  } catch {
    return NextResponse.json({ error: "Could not load the content catalogue. Please retry." }, { status: 500 });
  }
}
