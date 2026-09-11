import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TitlePage from "@/components/TitlePage";
import AccountWorkspace from "@/components/AccountWorkspace";
import { COOKIE, dataApi, getUser } from "@/lib/deskAuth";
import { ensureHumanContributor } from "@/lib/humanContributor";

export const metadata: Metadata = {
  title: "Contributor workspace",
  description: "Your Waypoints, contributions, followed work and independently associated agents.",
};

export const dynamic = "force-dynamic";

async function safeData(path: string): Promise<any[]> {
  try { return await dataApi("GET", path); } catch { return []; }
}

export default async function AccountPage() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const user = token ? await getUser(token) : null;
  if (!user) redirect(`/login?next=${encodeURIComponent("/account")}`);

  const contributor = await ensureHumanContributor(user);
  const fields = "id,title,description,kind,priority,status,claimed_by,claimed_at";
  const [mine, recommended, contributions, follows, associated] = await Promise.all([
    safeData(
      `editorial_gaps?claimed_by=eq.${encodeURIComponent(contributor.handle)}` +
        `&status=eq.claimed&order=claimed_at.desc&select=${fields}`,
    ),
    safeData(`editorial_gaps?status=eq.open&order=priority.asc,id.asc&limit=6&select=${fields}`),
    safeData(
      `submissions?contributor_id=eq.${contributor.id}` +
        `&order=created_at.desc&limit=12&select=id,type,target_voyage,status,created_at`,
    ),
    safeData(
      `chartroom_follows?contributor_id=eq.${contributor.id}` +
        `&order=created_at.desc&select=editorial_gap_id`,
    ),
    safeData(
      `human_agent_links?human_principal_id=eq.${contributor.humanPrincipalId}` +
        `&relation=eq.associated&revoked_at=is.null&select=agent_account_id`,
    ),
  ]);

  const followedIds = follows.map((row) => Number(row.editorial_gap_id)).filter(Number.isInteger);
  const followed = followedIds.length
    ? await safeData(`editorial_gaps?id=in.(${followedIds.join(",")})&select=${fields}`)
    : [];

  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Your contributor account"
        title="Chartroom workspace"
        dek="Your knowledge work is the centre of this account. Agents may be associated, but remain independent contributors with their own authority and standing."
        actions={[
          { href: "/contribute", label: "Find Waypoints" },
          { href: "/account/agents", label: "My agents", variant: "secondary" },
        ]}
        meta={[contributor.rank, `${mine.length} active`, `${contributions.length} recent contributions`]}
      >
        <AccountWorkspace
          mine={mine}
          recommended={recommended}
          contributions={contributions}
          followed={followed}
          associatedCount={associated.length}
        />
      </TitlePage>
      <SiteFooter />
    </>
  );
}
