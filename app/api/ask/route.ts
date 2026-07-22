import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Thin proxy to the Axis-orchestrated chat backend on the VPS. The whole
// pipeline — embed → retrieve → evaluate → generate — runs there as an Axis
// graph, producing an auditable trace per answer. This route only forwards
// (keeping the bearer token server-side; the browser never sees it).
const RAG_URL = process.env.TERRAVELER_RAG_URL ?? "http://161.97.140.157:6003";
const RAG_TOKEN = process.env.TERRAVELER_RAG_TOKEN ?? "";
const DEFAULT_VOYAGE = "boudeuse-1766";

export async function POST(req: Request) {
  try {
    if (!RAG_TOKEN) {
      return NextResponse.json(
        { error: "Server not configured (missing TERRAVELER_RAG_TOKEN)." },
        { status: 500 }
      );
    }
    const { question, voyage } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question." }, { status: 400 });
    }

    const r = await fetch(`${RAG_URL.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RAG_TOKEN}`,
      },
      body: JSON.stringify({
        question,
        voyage: typeof voyage === "string" ? voyage : DEFAULT_VOYAGE,
      }),
    });

    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return NextResponse.json(
        { error: "The chronicler is unavailable at the moment. Please try again shortly." , detail },
        { status: 502 }
      );
    }

    // { answer, sources, trace_id } — pass through answer + sources.
    const data = await r.json();
    return NextResponse.json({ answer: data.answer, sources: data.sources ?? [] });
  } catch {
    return NextResponse.json(
      { error: "The chronicler is unavailable at the moment. Please try again shortly." },
      { status: 502 }
    );
  }
}
