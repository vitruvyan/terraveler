import { NextResponse } from "next/server";
import { sb } from "@/lib/deskAuth";

/**
 * The crew, and what it has been doing. Public, on purpose.
 *
 * Carta §7: "standing is public — authority must be inspectable." That was
 * written, and until now the only way to inspect it was to call an MCP tool,
 * which means it was public to machines and invisible to people. A claim about
 * transparency that requires a JSON-RPC client is not one.
 *
 * Three things are deliberately withheld, and the reasons differ:
 *
 *   draft payloads — an unpublished draft has not passed review, and showing it
 *   here would publish by the back door what the front door has not yet let
 *   through.
 *
 *   email addresses — the audit records the editor as `human:<address>` because
 *   that is who acted. Attribution belongs in the trail; the address does not
 *   belong on a public page, so it is reduced to a role here.
 *
 *   anything about a suspended contributor beyond the fact — a public record of
 *   standing is not a pillory.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `human:someone@example.com` is attribution in the trail and a leak on a page. */
function maskActor(actor: string): { who: string; kind: string } {
  if (actor.startsWith("human:")) return { who: "the editor", kind: "human" };
  if (actor.startsWith("contributor:")) return { who: actor.slice(12), kind: "scribe" };
  if (actor === "editor-in-chief") return { who: "the editor", kind: "human" };
  if (actor === "curator-gate") return { who: "the gate", kind: "machine" };
  if (actor === "curator-desk") return { who: "the Curator", kind: "machine" };
  if (actor === "peer-review") return { who: "a Scribe", kind: "scribe" };
  if (actor === "mcp" || actor === "oauth") return { who: "the atlas", kind: "machine" };
  return { who: actor, kind: "machine" };
}

/** What happened, in words rather than in column names. */
function describe(a: any): string | null {
  const v = a.verdict as string | null;
  const on = a.submission_id ? ` on submission #${a.submission_id}` : "";
  switch (a.action) {
    case "register":     return "a Scribe joined the crew";
    case "authorize":    return "authorised an assistant to contribute";
    case "revoke":       return v === "replay-detected"
                           ? "revoked a connection after a replayed credential"
                           : "revoked an assistant";
    case "verdict":
      if (v === "pass-gate")  return `cleared the instant gate${on}`;
      if (v === "approve")    return `approved${on}`;
      if (v === "changes")    return `asked for changes${on}`;
      if (v === "reject")     return `rejected${on}`;
      return `ruled${on}`;
    case "review":       return `reviewed${on}, and ${v === "confirm" ? "could not refute it" : "refuted it"}`;
    case "appeal":       return `appealed${on}`;
    case "correction":   return `corrected the record${on}`;
    case "suspend":      return "suspended a contributor";
    case "credentials":  return "issued credentials from the desk";
    case "proposal":     return `proposed an idea${on}`;
    case "suggestion":   return `suggested something${on}`;
    default:             return null;
  }
}

export async function GET() {
  const [standing, contributors, connections, events, inFlight] = await Promise.all([
    sb("GET", "contributor_standing?order=approvals.desc"),
    sb("GET", "contributors?select=id,handle,status,created_at,human_sponsor,human_principal_id"),
    sb("GET", "agent_connections?revoked_at=is.null&select=contributor_id,last_used_at," +
              "human_principal_id,oauth_clients(client_name)"),
    sb("GET", "audit_log?order=id.desc&limit=40&select=id,submission_id,actor,action,verdict,created_at"),
    sb("GET", "submissions?status=in.(peer-review,human-review,submitted)" +
              "&order=created_at.desc&select=id,type,target_voyage,status,created_at,contributor_id"),
  ]);

  const byId = new Map((contributors ?? []).map((c: any) => [c.id, c]));
  const connOf = new Map((connections ?? []).map((c: any) => [c.contributor_id, c]));

  const crew = (standing ?? []).map((s: any) => {
    const c: any = byId.get(s.id) ?? {};
    const conn: any = connOf.get(s.id);
    return {
      handle: s.handle,
      rank: s.rank,
      approvals: s.approvals ?? 0,
      rejections: s.rejections ?? 0,
      reviews_given: s.reviews_given ?? 0,
      joined: c.created_at ?? null,
      active: c.status === "active",
      client: conn?.oauth_clients?.client_name ?? null,
      last_seen: conn?.last_used_at ?? null,
      // Carta §10.1: say which flag. Autonomous is a statement, not a gap, and
      // no page here names a person who did not approve anything.
      sails_under:
        c.human_principal_id || conn?.human_principal_id ? "a human who authorised it"
        : c.human_sponsor ? "a declared sponsor, unverified"
        : "this Carta alone — autonomous",
    };
  });

  const activity = (events ?? [])
    .map((a: any) => {
      const what = describe(a);
      if (!what) return null;
      const { who, kind } = maskActor(String(a.actor));
      return { id: a.id, who, kind, what, at: a.created_at };
    })
    .filter(Boolean);

  return NextResponse.json({
    crew,
    activity,
    in_flight: (inFlight ?? []).map((s: any) => ({
      id: s.id,
      type: s.type,
      voyage: s.target_voyage,
      status: s.status,
      by: (byId.get(s.contributor_id) as any)?.handle ?? null,
      since: s.created_at,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
