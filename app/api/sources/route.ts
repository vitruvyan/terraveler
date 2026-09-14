import { NextRequest, NextResponse } from "next/server";
import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function headers(): Record<string, string> {
  const out: Record<string, string> = {};
  if (POSTGREST_SERVICE_KEY) {
    out.apikey = POSTGREST_SERVICE_KEY;
    out.Authorization = `Bearer ${POSTGREST_SERVICE_KEY}`;
  }
  return out;
}

async function pg(path: string) {
  if (!POSTGREST_URL) return null;
  const response = await fetch(`${POSTGREST_URL}/rest/v1/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`source catalogue backend ${response.status}`);
  return response.json();
}

export async function GET(req: NextRequest) {
  if (!POSTGREST_URL) {
    return NextResponse.json({ error: "source catalogue unavailable" }, { status: 503 });
  }

  const url = new URL(req.url);
  const idRaw = url.searchParams.get("id");
  const parsedId = idRaw == null ? undefined : Number(idRaw);
  if (idRaw != null && (!Number.isInteger(parsedId) || (parsedId as number) <= 0)) {
    return NextResponse.json({ error: "invalid source id" }, { status: 400 });
  }
  const id = parsedId as number | undefined;

  try {
    const endpointFilter = id == null ? "status=eq.active" : `id=eq.${id}`;
    const endpoints = await pg(
      `source_endpoints?${endpointFilter}` +
      `&select=id,institution_id,host_pattern,match_type,status,trust_mode,last_verified_at,next_reverification_at,reverification_policy` +
      `&order=host_pattern.asc`,
    );

    if (id != null && (!endpoints || endpoints.length === 0)) {
      return NextResponse.json({ error: "source not found" }, { status: 404 });
    }

    const institutionIds = [...new Set((endpoints ?? []).map((e: any) => Number(e.institution_id)).filter(Boolean))];
    const institutions = institutionIds.length
      ? await pg(`source_institutions?id=in.(${institutionIds.join(",")})&select=id,slug,name,country,primary_languages`)
      : [];
    const institutionById = new Map((institutions ?? []).map((i: any) => [Number(i.id), i]));

    const endpointIds = (endpoints ?? []).map((e: any) => Number(e.id));
    const decisions = endpointIds.length
      ? await pg(
          `source_policy_decisions?endpoint_id=in.(${endpointIds.join(",")})` +
          `&decision_outcome=eq.approve` +
          `&select=id,endpoint_id,decision_outcome,trust_mode,rights_class,rights_identifier,rights_uri,carta_version,reason,timestamp` +
          `&order=timestamp.desc`,
        )
      : [];

    const latestDecision = new Map<number, any>();
    for (const d of decisions ?? []) {
      const endpointId = Number(d.endpoint_id);
      if (!latestDecision.has(endpointId)) latestDecision.set(endpointId, d);
    }

    const collections = endpointIds.length
      ? await pg(
          `source_collections?endpoint_id=in.(${endpointIds.join(",")})` +
          `&status=eq.active&select=id,endpoint_id,name,path_prefix,status,trust_mode,last_verified_at,next_reverification_at` +
          `&order=name.asc`,
        )
      : [];
    const collectionsByEndpoint = new Map<number, any[]>();
    for (const c of collections ?? []) {
      const endpointId = Number(c.endpoint_id);
      const current = collectionsByEndpoint.get(endpointId) ?? [];
      current.push(c);
      collectionsByEndpoint.set(endpointId, current);
    }

    const sources = (endpoints ?? []).map((endpoint: any) => ({
      id: Number(endpoint.id),
      host_pattern: endpoint.host_pattern,
      match_type: endpoint.match_type,
      status: endpoint.status,
      trust_mode: endpoint.trust_mode,
      last_verified_at: endpoint.last_verified_at,
      next_reverification_at: endpoint.next_reverification_at,
      reverification_policy: endpoint.reverification_policy,
      institution: institutionById.get(Number(endpoint.institution_id)) ?? null,
      policy: latestDecision.get(Number(endpoint.id)) ?? null,
      collections: collectionsByEndpoint.get(Number(endpoint.id)) ?? [],
    }));

    return NextResponse.json(
      {
        sources,
        count: sources.length,
        semantics: {
          source: "A governed endpoint or collection Terraveler may consult under an explicit trust and rights policy.",
          note: "This catalogue describes admissible source infrastructure, not every individual book, page, image or claim currently used by the atlas.",
        },
      },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("public source catalogue failed", error);
    return NextResponse.json({ error: "source catalogue unavailable" }, { status: 503 });
  }
}
