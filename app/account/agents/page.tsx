import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { COOKIE, getUser, sb } from "@/lib/deskAuth";
import AgentList from "@/components/AgentList";

export const metadata: Metadata = {
  title: "Connected agents",
  description: "Every assistant you have authorised to contribute to Terraveler, and how to revoke one.",
};

/**
 * The page the consent screen promises.
 *
 * It promised it before this existed, which a red-team found by clicking the
 * link: a 404 at the end of a sentence that says "you can revoke this at any
 * time" is worse than not offering the reassurance. Granting access is only
 * half a permission system.
 *
 * One row per agent, revocable one at a time — the point of separating a
 * connection from a contributor is that revoking ChatGPT must not revoke
 * Claude, and that is only true if a person can actually do it.
 */
export const dynamic = "force-dynamic";

export default async function Agents() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const user = token ? await getUser(token) : null;
  if (!user) redirect(`/login?next=${encodeURIComponent("/account/agents")}`);

  const principals = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user!.sub)}&select=id`);
  const principal = principals?.[0];

  const rows = principal
    ? await sb("GET",
        `agent_connections?human_principal_id=eq.${principal.id}` +
        `&order=created_at.desc&select=id,client_id,scopes,created_at,last_used_at,revoked_at,` +
        `contributors(handle),oauth_clients(client_name)`)
    : [];

  return (
    <>
      <SiteHeader />
      <main className="prose" style={{ maxWidth: 760 }}>
        <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
          Your account
        </span>
        <h1 style={{ margin: "6px 0 10px", fontSize: "2rem" }}>Connected agents</h1>
        <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
          Every assistant you have authorised to write to Terraveler on your behalf.
          Revoking one stops it immediately and leaves the others untouched — that
          separation is the reason each connection is its own thing.
        </p>

        {rows.length === 0 ? (
          <p style={{ marginTop: 28 }}>
            None yet. An assistant asks for this the first time it tries to contribute;
            until then it can read the whole atlas without any of us doing anything.{" "}
            <a href="/connect">Connect one →</a>
          </p>
        ) : (
          <AgentList
            agents={rows.map((r: any) => ({
              id: r.id,
              name: r.oauth_clients?.client_name || "An assistant",
              handle: r.contributors?.handle ?? null,
              scopes: r.scopes ?? [],
              created: String(r.created_at).slice(0, 10),
              lastUsed: r.last_used_at ? String(r.last_used_at).slice(0, 10) : null,
              revoked: Boolean(r.revoked_at),
            }))}
          />
        )}

        <p style={{ marginTop: 34, fontSize: 14, color: "var(--ink-soft)" }}>
          Revoking an agent does not remove what it has already contributed. Published
          work stays published and the audit trail keeps its name on it, because a record
          that can be erased is not a record.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
