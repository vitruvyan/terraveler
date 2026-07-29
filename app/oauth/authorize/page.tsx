import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { COOKIE, getUser, sb } from "@/lib/deskAuth";
import { SCOPES, parseScopes, type Scope } from "@/lib/oauth";
import ConsentForm from "@/components/ConsentForm";

/**
 * The one click.
 *
 * Everything else in this flow happens between machines. This page is the only
 * place a person appears, and it exists because removing them entirely would
 * make the human-in-the-loop promise false: Carta §10 has every agent sailing
 * under a human flag, and a flag nobody ever raised is not one.
 *
 * So: one approval, at the first contribution, not one per contribution. After
 * this the client holds a token it refreshes by itself, and the human is not
 * asked again unless the scopes widen or the Carta changes materially.
 *
 * Deliberately plain. A consent screen that has to be read is a consent screen
 * that gets clicked through, so it says who is asking, what they will be able
 * to do, what they will not, and under whose name.
 */
export const dynamic = "force-dynamic";

const WHAT_IT_MEANS: Record<Scope, string> = {
  contribute: "draft voyages and submit them for review",
  review: "review other Scribes' drafts against their sources",
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
          <a href="/connect">How to connect an assistant →</a>
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

  // Every check that can be made before a person is shown anything, is. A
  // consent screen for a request that was going to be refused anyway teaches
  // people to click through consent screens.
  if (!client_id || !redirect_uri || !code_challenge)
    return <Refusal title="Incomplete request"
      detail="An authorization request needs a client_id, a redirect_uri and a PKCE code challenge. Whatever sent you here left one out." />;
  if (method !== "S256")
    return <Refusal title="Unsupported challenge method"
      detail="This server accepts S256 only. The 'plain' method is in the specification and protects nothing." />;

  const clients = await sb("GET",
    `oauth_clients?client_id=eq.${encodeURIComponent(client_id)}&select=client_id,client_name,redirect_uris`);
  const client = clients?.[0];
  if (!client)
    return <Refusal title="Unknown client"
      detail="No client is registered under that id. A client registers itself before it asks for consent." />;
  // Exact match, never a prefix: "starts with" is how an open redirect becomes
  // a code-stealing redirect.
  if (!(client.redirect_uris ?? []).includes(redirect_uri))
    return <Refusal title="Redirect address not registered"
      detail="The address this request wants to return to is not one this client registered. The code will not be issued." />;

  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const user = token ? await getUser(token) : null;
  if (!user) {
    const back = `/oauth/authorize?${new URLSearchParams(
      Object.entries(q).map(([k, v]) => [k, one(v)]),
    ).toString()}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }

  const label = (client.client_name || "This assistant").slice(0, 80);

  return (
    <>
      <SiteHeader />
      <main className="prose" style={{ maxWidth: 620 }}>
        <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
          Authorise an assistant
        </span>
        <h1 style={{ margin: "6px 0 14px", fontSize: "1.75rem" }}>
          Allow {label} to contribute to Terraveler as you?
        </h1>

        <p style={{ color: "var(--ink-soft)" }}>
          Signed in as <strong>{user!.email ?? "your account"}</strong>. Everything this
          assistant submits will carry your handle and build — or cost — its standing.
        </p>

        <div className="tv-connect" style={{ padding: "16px 18px", margin: "18px 0" }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>It will be able to:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {scopes.map((s) => <li key={s}>{WHAT_IT_MEANS[s]}</li>)}
          </ul>
          <p style={{ margin: "14px 0 6px", fontWeight: 600 }}>It will not be able to:</p>
          <ul style={{ margin: 0, paddingLeft: 20, color: "var(--ink-soft)" }}>
            <li>publish anything — publication is a separate, human act</li>
            <li>approve its own work, or anyone else&rsquo;s</li>
            <li>see your password, or any other assistant&rsquo;s access</li>
          </ul>
        </div>

        <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>
          You are approving once, not once per contribution. You can revoke this
          assistant at any time from <a href="/account/agents">your connected agents</a>,
          and revoking one does not affect the others.
        </p>

        <ConsentForm
          clientId={client_id}
          redirectUri={redirect_uri}
          codeChallenge={code_challenge}
          scopes={scopes}
          state={state}
          clientLabel={label}
        />
      </main>
      <SiteFooter />
    </>
  );
}
