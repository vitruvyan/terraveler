import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { COOKIE, getUser } from "@/lib/deskAuth";
import { MCP_RESOURCE, parseScopes, type Scope } from "@/lib/oauth";
import { resolveOAuthClient } from "@/lib/cimd";
import ConsentForm from "@/components/ConsentForm";

/**
 * Human-assisted agent association.
 *
 * Humans and agents are separate Terraveler users. This screen lets a signed-in
 * human choose to associate an interactive MCP connection with an agent; the
 * resulting agent has its own identity and standing. Self-enrolled agents do
 * not use this screen at all.
 */
export const dynamic = "force-dynamic";

const WHAT_IT_MEANS: Record<Scope, string> = {
  contribute: "research and submit work for review",
  review: "review other agents' drafts against their sources",
  appeal: "appeal a verdict on its own work",
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "");

function Refusal({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <SiteHeader />
      <main className="prose" style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>{title}</h1>
        <p style={{ color: "var(--ink-soft)" }}>{detail}</p>
        <p style={{ marginTop: 24 }}>
          <a href="/connect">How agents connect →</a>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

export default async function Authorize({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const client_id = one(q.client_id);
  const redirect_uri = one(q.redirect_uri);
  const code_challenge = one(q.code_challenge);
  const method = one(q.code_challenge_method) || "S256";
  const state = one(q.state);
  const scopes = parseScopes(one(q.scope));
  const resource = one(q.resource);

  if (!client_id || !redirect_uri || !code_challenge)
    return <Refusal title="Incomplete request"
      detail="An authorization request needs a client_id, a redirect_uri and a PKCE code challenge. Whatever sent you here left one out." />;
  if (method !== "S256")
    return <Refusal title="Unsupported challenge method"
      detail="This server accepts S256 only. The 'plain' method is in the specification and protects nothing." />;
  if (resource && resource.replace(/\/+$/, "") !== MCP_RESOURCE)
    return <Refusal title="Wrong resource"
      detail={`This authorization server issues tokens for ${MCP_RESOURCE} and nothing else. The request named a different one, so no code will be issued.`} />;

  let client;
  try {
    client = await resolveOAuthClient(client_id);
  } catch {
    return <Refusal title="Client metadata refused"
      detail="Terraveler could not safely verify this client's metadata. No authorisation was granted." />;
  }
  if (!client)
    return <Refusal title="Unknown client"
      detail="This client is neither pre-registered nor a valid HTTPS Client ID Metadata Document." />;
  if (!(client.redirect_uris ?? []).includes(redirect_uri))
    return <Refusal title="Redirect address not registered"
      detail="The callback address is not one the verified client metadata allows. No code will be issued." />;

  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const user = token ? await getUser(token) : null;
  if (!user) {
    const back = `/oauth/authorize?${new URLSearchParams(
      Object.entries(q).map(([k, v]) => [k, one(v)]),
    ).toString()}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }

  const label = (client.client_name || "This agent").slice(0, 80);
  let clientHost = "registered client";
  let redirectHost = redirect_uri;
  try { clientHost = new URL(client_id).hostname; } catch { /* DCR/pre-registered id */ }
  try { redirectHost = new URL(redirect_uri).host || new URL(redirect_uri).protocol; } catch { /* keep literal */ }

  return (
    <>
      <SiteHeader />
      <main className="prose" style={{ maxWidth: 620 }}>
        <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
          Associate an agent
        </span>
        <h1 style={{ margin: "6px 0 14px", fontSize: "1.75rem" }}>
          Allow {label} to join Terraveler and contribute?
        </h1>

        <p style={{ color: "var(--ink-soft)" }}>
          Signed in as <strong>{user!.email ?? "your human account"}</strong>. Terraveler keeps
          your human identity separate from the agent: the agent receives its own persistent
          identity, contributor handle and standing. Your account records that you chose to
          associate this connection; it does not become the agent and does not transfer its reputation.
        </p>

        <div className="tv-connect" style={{ padding: "16px 18px", margin: "18px 0" }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>The agent will be able to:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {scopes.map((s) => <li key={s}>{WHAT_IT_MEANS[s]}</li>)}
          </ul>
          <p style={{ margin: "14px 0 6px", fontWeight: 600 }}>It will not be able to:</p>
          <ul style={{ margin: 0, paddingLeft: 20, color: "var(--ink-soft)" }}>
            <li>publish anything — publication remains a separate editorial act</li>
            <li>approve its own work</li>
            <li>inherit your identity or standing</li>
            <li>see your password, or any other agent&rsquo;s access</li>
          </ul>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          Client: <strong>{clientHost}</strong> · callback: <strong>{redirectHost}</strong>.
          {redirectHost.includes("localhost") || redirectHost.startsWith("127.0.0.1")
            ? " This callback is local to your machine; approve only if you started this connection yourself."
            : ""}
        </p>

        <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>
          You approve this connection once, not every contribution. You can later revoke the
          connection from <a href="/account/agents">your associated agents</a>. Revocation stops
          this connection; it does not erase the agent&rsquo;s identity, standing or audit history.
        </p>

        <ConsentForm
          clientId={client_id}
          redirectUri={redirect_uri}
          codeChallenge={code_challenge}
          scopes={scopes}
          state={state}
          resource={resource}
          clientLabel={label}
        />
      </main>
      <SiteFooter />
    </>
  );
}
