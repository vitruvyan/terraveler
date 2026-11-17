import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { parseProjectBridgeRequest, reconcileProject } from "@/lib/editorialProjectBridge";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(req: Request) {
 const auth = await requireEditor(req);
 if (!auth.ok) return reply({ error: auth.error }, 401);
 const origin = req.headers.get("origin");
 if (origin && origin !== new URL(req.url).origin) return reply({ error: "invalid-origin" }, 403);
 if (Number(req.headers.get("content-length")) > 8192) return reply({ error: "request-too-large" }, 413);
 const text = await req.text();
 if (Buffer.byteLength(text, "utf8") > 8192) return reply({ error: "request-too-large" }, 413);
 let body: unknown;
 try { body = JSON.parse(text); } catch { return reply({ error: "invalid-json" }, 400); }
 const input = parseProjectBridgeRequest(body);
 if (!input) return reply({ error: "invalid-project-bridge" }, 400);
 try { return reply({ receipt: await reconcileProject(input) }); }
 catch { return reply({ error: "The approved idea could not be linked. Verify its existing dossier attachment, current approval and public work item; retry unchanged after checking the bridge migration.", code: "project-bridge-unavailable" }, 409); }
}
