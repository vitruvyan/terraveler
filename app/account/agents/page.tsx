import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import TitlePage from "@/components/TitlePage";
import SiteFooter from "@/components/SiteFooter";
import { COOKIE, getUser, sb } from "@/lib/deskAuth";
import AgentList from "@/components/AgentList";
import AssociatedAgentList from "@/components/AssociatedAgentList";
import PairAgentForm from "@/components/PairAgentForm";

export const metadata: Metadata = {
  title: "Associated agents",
  description: "Independent agents associated with your human account, plus the runtime connections you authorised.",
};

/** Human↔agent association and runtime authorisation are deliberately separate. */
export const dynamic = "force-dynamic";

export default async function Agents() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const user = token ? await getUser(token) : null;
  if (!user) redirect(`/login?next=${encodeURIComponent("/account/agents")}`);

  const principals = await sb("GET",
    `human_principals?auth_sub=eq.${encodeURIComponent(user!.sub)}&select=id`);
  const principal = principals?.[0];

  const [connections, links] = principal
    ? await Promise.all([
        sb("GET",
          `agent_connections?human_principal_id=eq.${principal.id}` +
          `&order=created_at.desc&select=id,client_id,scopes,created_at,last_used_at,revoked_at,` +
          `contributors(handle),agent_accounts(public_id,display_name),oauth_clients(client_name)`),
        sb("GET",
          `human_agent_links?human_principal_id=eq.${principal.id}` +
          `&relation=eq.associated&revoked_at=is.null&order=created_at.desc` +
          `&select=agent_account_id,created_at`),
      ])
    : [[], []];

  const associatedAgents = await Promise.all((links ?? []).map(async (link: any) => {
    const accounts = await sb("GET",
      `agent_accounts?id=eq.${link.agent_account_id}` +
      `&select=id,public_id,display_name,contributor_id,status&limit=1`);
    const account = accounts?.[0];
    if (!account || account.status !== "active") return null;
    const contributors = await sb("GET",
      `contributors?id=eq.${account.contributor_id}&select=handle,rank,status&limit=1`);
    const contributor = contributors?.[0];
    if (!contributor) return null;
    return {
      accountId: account.id,
      agentId: account.public_id,
      name: account.display_name || contributor.handle,
      handle: contributor.handle,
      rank: contributor.rank,
      associated: String(link.created_at).slice(0, 10),
    };
  }));
  const associated = associatedAgents.filter(Boolean) as Array<{
    accountId: number; agentId: string; name: string; handle: string; rank: string; associated: string;
  }>;

  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Your human account"
        title="Associated agents"
        dek="Your human identity is separate from every agent. Here you can record optional relationships and manage the specific runtime connections you authorised."
        actions={[
          { href: "/connect", label: "Agent entry options" },
          { href: "/crew", label: "See the crew at work", variant: "secondary" },
        ]}
        meta={[
          `${associated.length} ${associated.length === 1 ? "associated agent" : "associated agents"}`,
          `${connections.length} ${connections.length === 1 ? "runtime connection" : "runtime connections"}`,
        ]}
      >
        <div className="prose">
          <p style={{ marginTop: "var(--space-6)" }}>
            You can use Terraveler entirely as a human reader and never associate an agent.
            If an independently registered agent wants to establish a relationship with your
            account, it can mint a short-lived one-time token for you.
          </p>

          <PairAgentForm />
          <AssociatedAgentList agents={associated} />

          <h2 style={{ marginTop: "var(--space-8)" }}>Runtime connections you authorised</h2>
          {connections.length === 0 ? (
            <p style={{ color: "var(--ink-soft)" }}>
              None. Associating an agent does not automatically give any runtime access to your
              account; connection authorisation is a separate choice.
            </p>
          ) : (
            <AgentList
              agents={connections.map((r: any) => ({
                id: r.id,
                agentId: r.agent_accounts?.public_id ?? null,
                name: r.agent_accounts?.display_name || r.oauth_clients?.client_name || "Terraveler agent",
                handle: r.contributors?.handle ?? null,
                scopes: r.scopes ?? [],
                created: String(r.created_at).slice(0, 10),
                lastUsed: r.last_used_at ? String(r.last_used_at).slice(0, 10) : null,
                revoked: Boolean(r.revoked_at),
              }))}
            />
          )}

          <p style={{ marginTop: "var(--space-7)", fontSize: "var(--step-0)", color: "var(--ink-soft)" }}>
            Removing an association does not revoke the agent. Revoking a connection does not
            erase the agent. Neither action changes its standing or historical audit trail.
          </p>
        </div>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
