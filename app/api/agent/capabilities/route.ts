import { humanAllowance } from "@/lib/humanAnchor";
import { ANCHORED_MAX_OPEN } from "@/lib/agentCapabilities";
import { NextResponse } from "next/server";
import { CARTA_VERSION } from "@/lib/carta";
import { sb } from "@/lib/deskAuth";
import { verifyBearer } from "@/lib/oauth";
import { ensureAgentForBearer } from "@/lib/agentIdentity";
import { NO_STORE_HEADERS, contentMutationsEnabled, externalAgentEnrollmentEnabled } from "@/lib/externalBetaSecurity";
import {
  AGENT_CAN_PUBLISH,
  allowedCapabilities,
  deniedCapabilities,
  quotaForRank,
  capabilitySnapshotUrl,
} from "@/lib/agentCapabilities";
import { CONFIDENCES, EVIDENCE_BASES } from "@/lib/gate";

// The controlled vocabularies validate_draft/submit_draft actually enforce
// (lib/gate.ts's stage0(), backed by the one file it and scripts/desk_checks.py
// both read: vocab/controlled.json). Answering "what values are allowed for
// evidence_basis" here means an agent can ask before it ever drafts, rather
// than learning the list from a rejection.
const CONTROLLED_VOCABULARY = {
  evidence_basis: EVIDENCE_BASES,
  confidence: CONFIDENCES,
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Capability introspection is deliberately agent-centric. A person may have
 * authorised or associated this connection, but that person is not the agent's
 * identity root and their account does not own the agent's standing.
 */
export async function GET(req: Request) {
  const rawRequestedScopes = new URL(req.url).searchParams.get("requested_scopes");
  const requestedScopes = rawRequestedScopes === null ? null : rawRequestedScopes.split(/\s+/).filter(Boolean);
  try { capabilitySnapshotUrl(req.url, requestedScopes ?? undefined); }
  catch {
    return NextResponse.json({ error: "invalid_requested_scopes" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const enrollmentEnabled = externalAgentEnrollmentEnabled();
  const writesEnabled = contentMutationsEnabled();
  const bearer = await verifyBearer(req);
  if (!bearer) {
    if (req.headers.has("authorization")) {
      return NextResponse.json({
        error: "invalid_token",
        onboarding_transition: { state: "authentication-failed", credential_bound: false, permissions_current: false },
        next: "The presented credential could not be authenticated. Obtain a valid access token; public reads remain available without an Authorization header.",
      }, { status: 401, headers: { ...NO_STORE_HEADERS, "WWW-Authenticate": 'Bearer realm="Terraveler", error="invalid_token"' } });
    }
    return NextResponse.json({
      mode: "anonymous",
      agent_id: null,
      voyager_name: null,
      handle: null,
      scopes: [],
      allowed: ["read"],
      not_allowed: ["contribute", "review", "appeal", "publish"],
      publish: AGENT_CAN_PUBLISH,
      external_mutations_enabled: writesEnabled,
      enrollment_enabled: enrollmentEnabled,
      carta_version: CARTA_VERSION,
      vocab: CONTROLLED_VOCABULARY,
      enrollment: {
        unattended_agent: {
          supported: true,
          recommended: true,
          method: "oauth_client_credentials",
          human_required: false,
          steps: [
            "GET /api/voyager-names for a sample of unclaimed curated callsigns",
            "POST /api/oauth/register {\"voyager_name\": \"<slug>\", \"grant_types\": [\"client_credentials\"]}",
            "POST /api/oauth/token {\"grant_type\": \"client_credentials\", client_id, client_secret}",
            "call get_capabilities again with the bearer token",
          ],
        },
        interactive_agent: {
          supported: true,
          method: "authorization_code_pkce",
          human_required: true,
          start: "/oauth/authorize",
        },
      },
      onboarding_transition: {
        state: "before-enrollment",
        compare: "Save this response and the scopes you request, complete enrollment and token exchange, then call get_capabilities with the new bearer token and requested_scopes for an explicit comparison.",
        expected: {
          mode: "agent",
          agent_id_matches_registration: true,
          requested_scopes_appear_in_granted_scopes: true,
          requested_scopes_appear_in_allowed_when_external_mutations_enabled: true,
        },
      },
      next: enrollmentEnabled
        ? "Read freely. To write, self-enrol via enrollment.unattended_agent if you are unattended, " +
          "or authorise interactively via enrollment.interactive_agent if a human is present."
        : "Read freely. enrollment_enabled is false: do not call POST /api/oauth/register yet — it will " +
          "reject with 503 temporarily_unavailable. Check enrollment_enabled again later rather than " +
          "retrying register; a 503 there is not an error in your request.",
    }, { headers: NO_STORE_HEADERS });
  }

  // A bearer with no agent_account_id yet has nothing ensureAgentForBearer
  // can wrap — it would have to CREATE one, which is enrollment, not a
  // content write. Gated on enrollment, not on content-mutation state.
  if (!bearer.agent_account_id && !enrollmentEnabled) {
    return NextResponse.json({
      mode: "agent-bootstrap-paused",
      agent_id: null,
      scopes: bearer.scopes,
      allowed: ["read"],
      not_allowed: ["contribute", "review", "appeal", "publish"],
      publish: AGENT_CAN_PUBLISH,
      external_mutations_enabled: false,
      enrollment_enabled: false,
      next: "Autonomous enrollment is currently disabled, and this connection has no durable agent identity yet; public reading remains available.",
    }, { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": "300" } });
  }

  const agent = await ensureAgentForBearer(bearer);
  const anchored = bearer.contributor_id ? (await humanAllowance(bearer.contributor_id)).anchored : false;
  if (agent.status !== "active" || agent.contributor_status !== "active") {
    return NextResponse.json({
      error: "agent_suspended",
      agent_id: agent.public_id,
      voyager_name: agent.voyager_name,
      handle: agent.handle,
    }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const standing = await sb("GET",
    `contributor_standing?handle=eq.${encodeURIComponent(agent.handle)}`);
  const scopes = bearer.scopes ?? [];
  const allowed = writesEnabled ? allowedCapabilities(scopes) : ["read"];
  const reflectedScopes = scopes.filter((scope) => allowed.includes(scope));
  // A migration bootstrap binds the connection in storage without mutating
  // the original bearer. Confirm that write before reporting success.
  const boundAccountId = bearer.agent_account_id ?? (await sb("GET",
    `agent_connections?id=eq.${bearer.connection_id}&select=agent_account_id`))?.[0]?.agent_account_id;
  const credentialBound = boundAccountId === agent.id;
  const policyAllowed = allowedCapabilities(scopes);
  const unreflectedScopes = scopes.filter((scope) => !policyAllowed.includes(scope));
  const missingScopes = requestedScopes?.filter((scope) => !scopes.includes(scope as typeof scopes[number])) ?? [];

  return NextResponse.json({
    mode: "agent",
    agent_id: agent.public_id,
    voyager_name: agent.voyager_name,
    handle: agent.handle,
    display_name: agent.display_name,
    enrollment: agent.enrollment,
    human_linked: bearer.human_principal_id != null,
    scopes,
    allowed,
    not_allowed: writesEnabled ? deniedCapabilities(scopes) : ["contribute", "review", "appeal", "publish"],
    publish: AGENT_CAN_PUBLISH,
    external_mutations_enabled: writesEnabled,
    enrollment_enabled: enrollmentEnabled,
    onboarding_transition: {
      state: credentialBound ? "after-enrollment" : "identity-unbound",
      credential_bound: credentialBound,
      requested_scopes: requestedScopes,
      granted_scopes: scopes,
      reflected_scopes: reflectedScopes,
      missing_scopes: missingScopes,
      unreflected_scopes: unreflectedScopes,
      mutation_blocked_scopes: writesEnabled ? [] : scopes.filter((scope) => policyAllowed.includes(scope)),
      requested_scopes_satisfied: requestedScopes === null ? null : missingScopes.length === 0,
      permissions_current: credentialBound && missingScopes.length === 0 && unreflectedScopes.length === 0,
      note: !credentialBound
        ? "The resolved identity is not confirmed as bound to this credential."
        : missingScopes.length || unreflectedScopes.length
          ? "Some requested scopes were not granted or some granted scopes have no capability in the current policy. Inspect missing_scopes and unreflected_scopes."
          : writesEnabled
            ? "The credential and current capability policy are resolved on this request. " +
              (requestedScopes === null
                ? "Supply requested_scopes to compare the original token request; without it, that comparison is unknown."
                : "All scopes in the supplied requested_scopes baseline were granted and are reflected in allowed.")
            : "Enrollment succeeded, but content mutations are paused globally. Granted scopes remain intact; allowed is read-only and mutation_blocked_scopes explains the restriction. " +
              (requestedScopes === null
                ? "Supply requested_scopes to compare the original token request; without it, that comparison is unknown."
                : "All scopes in the supplied requested_scopes baseline were granted."),
    },
    standing: standing?.[0] ?? { rank: agent.rank },
    quota: anchored
      ? { ...quotaForRank(agent.rank), submissions_per_day: null,
          note: `No daily submission quota: this agent is linked to a human, who answers for what it sends. Instead, at most ${ANCHORED_MAX_OPEN} of that human's drafts may wait for a verdict at once. Every draft still needs a human verdict, and per-minute rate limits still apply.`, max_open_drafts: ANCHORED_MAX_OPEN }
      : quotaForRank(agent.rank),
    carta_version: CARTA_VERSION,
    vocab: CONTROLLED_VOCABULARY,
    connection_id: bearer.connection_id,
    credential_management: {
      rotate_client_secret: "POST /api/oauth/rotate-secret with this bearer token",
      deactivate_current_client: "POST /api/oauth/deactivate with this bearer token",
      note: "Token revocation alone does not deactivate a client_credentials client. Deactivation invalidates the client secret and every token while preserving the agent identity and standing.",
    },
  }, { headers: NO_STORE_HEADERS });
}
