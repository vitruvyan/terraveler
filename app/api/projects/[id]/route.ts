import { NextResponse } from "next/server";
import { getPublicProject } from "@/lib/editorialProjectBridge";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params;
 if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) return reply({ error: "invalid-project-id" }, 400);
 try {
  const project = await getPublicProject(Number(id));
  return project ? reply({ project }) : reply({ error: "not-found" }, 404);
 } catch { return reply({ error: "The public project is temporarily unavailable." }, 503); }
}
