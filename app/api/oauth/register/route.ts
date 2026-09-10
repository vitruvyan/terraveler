import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { rpc, sb } from "@/lib/deskAuth";
import { createAgentAccount, getAgentAccount } from "@/lib/agentIdentity";
import { sha256 } from "@/lib/oauth";
import { CARTA_VERSION } from "@/lib/carta";

/**
 * RFC 7591 compatibility registration.
 *
 * There are two distinct things here and they must not be conflated:
 * - an interactive MCP host registers a public OAuth client, then a signed-in
 *   human may choose to associate an independently identified Terraveler agent;
 * - an unattended actor asking for client_credentials self-enrols an AGENT
 *   ACCOUNT immediately and receives a software credential for that identity.
 *
 * An already-authenticated agent may also mint a short-lived runtime-binding
 * token and hand it to a new runtime. Registration then binds the new OAuth
 * client to the SAME agent account instead of creating a new identity.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_SOURCE_PER_HOUR = 10;
const GLOBAL_PER_HOUR = 2000;

function badRequest(error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status: 400 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return badRequest("invalid_client_metadata", "body must be JSON");

  const wantsCC = Array.isArray(body.grant_types)
    && body.grant_types.map(String).includes("client_credentials");
  const uris: unknown = body.redirect_uris ?? (wantsCC ? [] : undefined);
  if (!Array.isArray(uris) || (!uris.length && !wantsCC))
    return badRequest("invalid_redirect_uri", "redirect_uris is required and must be a non-empty array");

  const clean: string[] = [];
  for (const u of uris) {
    let parsed: URL;
    try {
      parsed = new URL(String(u));
    } catch {
      return badRequest("invalid_redirect_uri", `not a URL: ${String(u).slice(0, 120)}`);
    }
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !loopback && !parsed.protocol.includes("."))
      return badRequest("invalid_redirect_uri",
        `${parsed.protocol}//… is neither https nor a loopback nor an app scheme`);
    if (parsed.hash)
      return badRequest("invalid_redirect_uri", "a redirect URI may not carry a fragment");
    clean.push(parsed.toString());
  }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const source = sha256(
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown",
  ).slice(0, 32);
  const [mine, all] = await Promise.all([
    sb("GET", `oauth_clients?created_at=gte.${since}&source_hash=eq.${source}&select=id`),
    sb("GET", `oauth_clients?created_at=gte.${since}&select=id`),
  ]);
  if ((mine?.length ?? 0) >= PER_SOURCE_PER_HOUR)
    return NextResponse.json(
      { error: "temporarily_unavailable",
        error_description: `you have registered ${mine.length} clients this hour, which is ` +
          `the limit for one source. Nobody else is affected by this.` },
      { status: 429 },
    );
  if ((all?.length ?? 0) >= GLOBAL_PER_HOUR)
    return NextResponse.json(
      { error: "temporarily_unavailable",
        error_description: "registrations are paused site-wide for this hour — an emergency ceiling." },
      { status: 429 },
    );

  const grants: string[] = Array.isArray(body.grant_types)
    ? body.grant_types.map(String)
    : ["authorization_code", "refresh_token"];
  const selfEnrollingAgent = grants.includes("client_credentials");
  const runtimeLinkToken = typeof body.agent_link_token === "string"
    ? body.agent_link_token.trim()
    : "";
  if (runtimeLinkToken && !selfEnrollingAgent)
    return badRequest("invalid_agent_link", "agent_link_token is only valid for a client_credentials runtime");

  const client_id = `tv_${randomBytes(16).toString("hex")}`;
  const client_secret = selfEnrollingAgent ? randomBytes(32).toString("base64url") : null;
  const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : null;
  const agentName = typeof body.agent_name === "string" ? body.agent_name.slice(0, 120) : clientName;
  const operator = typeof body.operator === "string" ? body.operator.slice(0, 200) : null;

  let agent: Awaited<ReturnType<typeof createAgentAccount>> | null = null;
  let createdAgent = false;
  let reboundExistingAgent = false;

  if (selfEnrollingAgent && runtimeLinkToken) {
    const claimed = await rpc("claim_agent_link_token", {
      p_token_hash: sha256(runtimeLinkToken),
      p_purpose: "runtime-binding",
    });
    const agentAccountId = claimed?.[0]?.agent_account_id;
    if (!agentAccountId)
      return badRequest("invalid_agent_link", "this runtime-binding token is unknown, expired, already used or for another purpose");
    agent = await getAgentAccount(Number(agentAccountId));
    if (!agent || agent.status !== "active" || agent.contributor_status !== "active")
      return badRequest("invalid_agent_link", "the agent identity behind this token is not active");
    reboundExistingAgent = true;
  } else if (selfEnrollingAgent) {
    agent = await createAgentAccount({
      displayName: agentName,
      operator,
      enrollment: "self",
    });
    createdAgent = true;
  }

  try {
    await sb("POST", "oauth_clients", {
      client_id,
      client_name: clientName,
      redirect_uris: clean,
      registered_via: selfEnrollingAgent ? "client_credentials" : "dcr",
      source_hash: source,
      client_secret_hash: client_secret ? sha256(client_secret) : null,
      operator,
      carta_version: CARTA_VERSION,
      agent_account_id: agent?.id ?? null,
    });
  } catch (error) {
    if (createdAgent && agent) {
      await sb("DELETE", `agent_accounts?id=eq.${agent.id}`).catch(() => {});
      await sb("DELETE", `contributors?id=eq.${agent.contributor_id}`).catch(() => {});
    }
    throw error;
  }

  return NextResponse.json(
    {
      client_id,
      client_name: body.client_name ?? undefined,
      redirect_uris: clean,
      ...(client_secret && agent
        ? {
            agent_id: agent.public_id,
            handle: agent.handle,
            client_secret,
            token_endpoint_auth_method: "client_secret_post",
            grant_types: ["client_credentials"],
            identity_binding: reboundExistingAgent ? "existing-agent" : "new-agent",
            note: reboundExistingAgent
              ? "This new runtime is bound to the existing Terraveler agent. Its identity and standing were preserved; only the runtime credential is new."
              : "This registration created an independent Terraveler agent identity. Keep agent_id as the durable identity and client_secret as the software credential; the credential may rotate and the model/runtime may change without changing the agent or its standing.",
          }
        : {
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            note:
              "This registered an OAuth client only. If a signed-in human authorises it, Terraveler will create or associate a separate agent identity; the human account does not become that agent.",
          }),
      carta_version: CARTA_VERSION,
      carta: "https://www.terraveler.com/magna-carta",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 },
  );
}
