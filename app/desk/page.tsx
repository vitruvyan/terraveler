"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import { DeskHeading, DeskStanding, DeskLedger, ShipsLog } from "@/components/desk/Quarterdeck";
import SubmissionBrief from "@/components/desk/SubmissionBrief";
import {
  PendingSourceProposals, SourceDossier, ReverificationStatus,
  type PendingProposal, type ResolvedDecision, type DossierEndpoint,
  type EndpointDossierEntry, type EndpointContext, type MaterialDrift,
} from "@/components/desk/SourceGovernance";
import DeskSidebar, { type Section, type SubmissionsSub, type SourcesSub, type UsersSub } from "@/components/desk/DeskSidebar";
import { PromptEditor, type PromptVersion } from "@/components/desk/PromptRegistry";
import type { PromptKey } from "@/lib/promptRegistry";
import { CLAIM_TTL_DAYS } from "@/lib/agentCapabilities";

type Sub = {
  id: number;
  type: string;
  target_voyage: string | null;
  status: string;
  carta_version: string;
  created_at: string;
  payload: any;
  contributor: { handle: string; rank: string } | null;
  audit: { actor: string; action: string; verdict: string | null; findings: any; created_at: string }[];
  reviews: { reviewer: { handle: string; rank: string } | null; verdict: string; findings: any; created_at: string }[];
  escalated: boolean;
};

type SubGroups = { needs_verdict: Sub[]; peer_review: Sub[]; history: Sub[] };
const EMPTY_SUB_GROUPS: SubGroups = { needs_verdict: [], peer_review: [], history: [] };

/** Same shape whether the contributor behind it is a human's own standing
 *  or an agent's — one row in contributor_standing either way. */
type StandingSummary = {
  contributor_id: number;
  handle: string;
  rank: string | null;
  status: string;
  has_key: boolean;
  created_at: string | null;
  approvals: number;
  rejections: number;
  passed_curator: number;
  reviews_given: number;
};

type LinkedAgent = {
  agent_account_id: number;
  public_id: string;
  display_name: string | null;
  agent_status: string;
  relation: string;
  linked_at: string;
  contributor: StandingSummary | null;
};

type HumanUser = {
  principal_id: number;
  email: string | null;
  display_name: string | null;
  created_at: string;
  contributor: StandingSummary | null;
  agents: LinkedAgent[];
};

type LinkedHuman = {
  principal_id: number;
  email: string | null;
  display_name: string | null;
  relation: string;
  linked_at: string;
};

type AgentUser = {
  contributor: StandingSummary;
  agent_account: {
    agent_account_id: number;
    public_id: string;
    display_name: string | null;
    operator: string | null;
    voyager_name: string | null;
    enrollment: string;
    agent_status: string;
    created_at: string;
  } | null;
  is_internal: boolean;
  humans: LinkedHuman[];
};

type Demand = { id: number; query: string; hits: number; first_seen: string; last_seen: string };

type ClaimedWaypoint = {
  id: number;
  title: string;
  waypoint_type: string | null;
  kind: string;
  claimed_by: string | null;
  claimed_at: string | null;
  context_voyage: string | null;
  context_waypoint_seq: number | null;
  priority: number;
};

type Overview = {
  counts: {
    submissions: Record<string, number>;
    gaps: Record<string, number>;
    contributors: Record<string, number>;
    reviews_total: number;
    appealed: number;
    escalations: number;
  };
  feed: { submission_id: number | null; actor: string; action: string; verdict: string | null; findings: any; created_at: string }[];
  demand?: Demand[];
};

type Analytics = {
  counts: { today: number; last7: number; last30: number };
  truncated: boolean;
  daily: { day: string; n: number }[];
  topPaths: { path: string; n: number }[];
};

/* Where a submission stands. The values live in :root — four of the seven
   hexes that used to sit here failed AA on parchment while being the text
   colour of the badge that carries them. */
const STATUS_COLOR: Record<string, string> = {
  submitted: "var(--state-wait)",
  "peer-review": "var(--state-review)",
  "human-review": "var(--state-desk)",
  approved: "var(--state-ok)",
  rejected: "var(--state-no)",
  "curator-rejected": "var(--state-no)",
  "changes-requested": "var(--state-changes)",
  // Carta §5: appealable to the Editor-in-chief alone, and nobody else's to
  // rule on (Ship's Officers §4.1). Alarm, not one of the six ordinary
  // states — it is a claim on the editor's attention, not a stage a
  // submission is passing through.
  appealed: "var(--state-alarm)",
};

/** The grounds a contributor filed with `appeal` (app/api/mcp/route.ts),
 *  recorded as audit_log findings [["APPEAL", 0, grounds]]. Read here so the
 *  editor rules with them beside the draft rather than inside the collapsed
 *  audit trail. */
function appealGrounds(s: Sub): string | null {
  const row = [...s.audit].reverse().find((a) => a.action === "appeal");
  const f = Array.isArray(row?.findings) ? row!.findings[0] : null;
  return Array.isArray(f) ? String(f[2] ?? "") : null;
}

const RANKS = ["cabin-boy", "deckhand", "navigator", "captain", "admiral"];

const SECTIONS: Section[] = ["overview", "submissions", "sources", "users", "waypoints", "prompts", "analytics"];
const SECTION_TITLE: Record<Section, string> = {
  overview: "Quarterdeck", submissions: "Submissions", sources: "Sources", users: "Users",
  waypoints: "Waypoints, taken", prompts: "Prompts", analytics: "Analytics",
};
const SUBMISSIONS_SUBS: SubmissionsSub[] = ["needs_verdict", "peer_review", "history"];
/* Three sections, not the old four organised by which source table happened
 * to hold the row (pending/flagged/drift/resolved). `flagged` and `drift`
 * read tables no writer populated in production — a generic empty state
 * there read as "all clear" when the truth was "this pipeline never ran".
 * See components/desk/SourceGovernance.tsx's own header comment. */
const SOURCES_SUBS: SourcesSub[] = ["pending", "dossier", "reverify"];
const USERS_SUBS: UsersSub[] = ["humans", "agents"];
const SUB_LABEL: Record<string, string> = {
  needs_verdict: "Needs your verdict", peer_review: "In peer review", history: "History",
  pending: "Pending proposals", dossier: "Source dossier", reverify: "Reverification",
  humans: "Humans", agents: "Agents",
};

/* A Telegram "Review" button, or any bookmarked link, has to land the editor
 * somewhere specific — a section AND, where one exists, a subsection — or it
 * is not actually a shortcut. Read once on mount; the sidebar owns
 * navigation after that. Absent or invalid values fall back to the
 * subsection that actually needs a decision, so an old ?tab=sources link
 * (no &sub=) still lands on "pending" rather than an arbitrary first entry. */
function initialSection(): Section {
  if (typeof window === "undefined") return "overview";
  const t = new URLSearchParams(window.location.search).get("tab");
  return (SECTIONS as string[]).includes(t ?? "") ? (t as Section) : "overview";
}
function initialSub<T extends string>(valid: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const s = new URLSearchParams(window.location.search).get("sub");
  return (valid as readonly string[]).includes(s ?? "") ? (s as T) : fallback;
}

/* Signed out is not the same as signed in without the desk, and the old
   boolean could not tell them apart — /api/desk/overview answers 401 to both.
   So the desk showed a login form to someone already holding a session. */
type Standing = "checking" | "guest" | "not-editor" | "editor";

export default function Desk() {
  const [standing, setStanding] = useState<Standing>("checking");
  const [me, setMe] = useState<{ email?: string }>({});
  const [err, setErr] = useState("");
  const [section, setSection] = useState<Section>(initialSection);
  const [submissionsSub, setSubmissionsSub] = useState<SubmissionsSub>(() => initialSub(SUBMISSIONS_SUBS, "needs_verdict"));
  const [sourcesSub, setSourcesSub] = useState<SourcesSub>(() => initialSub(SOURCES_SUBS, "pending"));
  const [usersSub, setUsersSub] = useState<UsersSub>(() => initialSub(USERS_SUBS, "humans"));
  const [subGroups, setSubGroups] = useState<SubGroups>(EMPTY_SUB_GROUPS);
  const [pendingSources, setPendingSources] = useState<PendingProposal[]>([]);
  const [resolvedSources, setResolvedSources] = useState<ResolvedDecision[]>([]);
  const [flaggedEndpoints, setFlaggedEndpoints] = useState<DossierEndpoint[]>([]);
  const [materialDrifts, setMaterialDrifts] = useState<MaterialDrift[]>([]);
  const [allEndpoints, setAllEndpoints] = useState<DossierEndpoint[]>([]);
  const [endpointDossier, setEndpointDossier] = useState<Record<string, EndpointDossierEntry>>({});
  const [endpointContext, setEndpointContext] = useState<Record<string, EndpointContext>>({});
  const [reverificationEvidence, setReverificationEvidence] = useState<{ any_reverifications: boolean; any_drift_evaluations: boolean }>({
    any_reverifications: false, any_drift_evaluations: false,
  });
  const [humans, setHumans] = useState<HumanUser[]>([]);
  const [agentUsers, setAgentUsers] = useState<AgentUser[]>([]);
  const [claims, setClaims] = useState<ClaimedWaypoint[]>([]);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [rankPick, setRankPick] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  /* One door for everyone: whoever is not signed in goes to the same /login
     as any reader, and comes back here. The desk no longer carries a sign-in
     form of its own — the five API routes behind it each call requireEditor,
     so the role is enforced where it matters rather than at a second front
     door with its own copy to keep in step. */
  async function load() {
    const who = await fetch("/api/desk/me").then((r) => r.json()).catch(() => ({ signed_in: false }));
    if (!who.signed_in) { window.location.href = "/login?next=/desk"; return; }
    setMe({ email: who.email });
    if (!who.is_editor) { setStanding("not-editor"); return; }
    setStanding("editor");

    const r = await fetch("/api/desk/overview");
    if (r.ok) setOverview(await r.json());
    const [rs, rc, ra, rg, rp, rw] = await Promise.all([
      fetch("/api/desk/submissions"), fetch("/api/desk/users"), fetch("/api/desk/analytics"),
      fetch("/api/desk/governance"), fetch("/api/desk/prompts"), fetch("/api/desk/claims"),
    ]);
    if (rs.ok) setSubGroups({ ...EMPTY_SUB_GROUPS, ...(await rs.json()) });
    if (rc.ok) {
      const u = await rc.json();
      setHumans(u.humans ?? []);
      setAgentUsers(u.agents ?? []);
    }
    if (ra.ok) setAnalytics(await ra.json());
    if (rp.ok) setPromptVersions((await rp.json()).versions ?? []);
    if (rw.ok) setClaims((await rw.json()).claims ?? []);
    if (rg.ok) {
      const gov = await rg.json();
      setPendingSources(gov.queue?.pending_proposals ?? []);
      setResolvedSources(gov.queue?.recent_decisions ?? []);
      setFlaggedEndpoints(gov.queue?.review_required_endpoints ?? []);
      setMaterialDrifts(gov.queue?.recent_material_drifts ?? []);
      setAllEndpoints(gov.queue?.all_endpoints ?? []);
      setEndpointDossier(gov.queue?.endpoint_dossier ?? {});
      setEndpointContext(gov.queue?.endpoint_context ?? {});
      setReverificationEvidence(gov.queue?.reverification_evidence ?? { any_reverifications: false, any_drift_evaluations: false });
    }
  }

  /** Sets the sidebar's own state and rewrites ?tab=&sub= to match, so a
   *  reload or a shared link lands back on the exact same subsection. */
  function navigate(next: Section, sub?: string) {
    setSection(next);
    if (next === "submissions" && sub) setSubmissionsSub(sub as SubmissionsSub);
    if (next === "sources" && sub) setSourcesSub(sub as SourcesSub);
    if (next === "users" && sub) setUsersSub(sub as UsersSub);
    const params = new URLSearchParams();
    params.set("tab", next);
    if (sub) params.set("sub", sub);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  async function savePrompt(key: PromptKey, body: string, notes: string) {
    setBusy(true);
    const r = await fetch("/api/desk/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_key: key, body, notes: notes || undefined }),
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    load();
  }

  async function resolveSource(
    id: number, decision: "approve" | "reject", trustMode: string, rightsClass: string, reason: string,
  ) {
    setBusy(true);
    const r = await fetch("/api/desk/governance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal_id: id, decision, trust_mode: trustMode, rights_class: rightsClass, reason }),
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    load();
  }

  useEffect(() => {
    // Returning from Google OAuth: the token arrives in the URL hash.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const access = hash.get("access_token");
    if (access) {
      window.history.replaceState(null, "", window.location.pathname);
      fetch("/api/desk/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* The refresh token rides in the same fragment and used to be thrown
           away, which is what capped a desk session at an hour. */
        body: JSON.stringify({ access_token: access, refresh_token: hash.get("refresh_token") ?? undefined }),
      }).then(async (r) => {
        if (!r.ok) setErr((await r.json()).error ?? "sign-in refused");
        load();
      });
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /** lib/deskVerdict.ts's Carta §10.4 dossier guard refuses an approve whose
   *  reviewers' dossier isn't clean (fewer than 2 reviews, or any refute)
   *  unless it's told this is deliberate. Nothing here ever collected that
   *  reason, so the guard was unconditional in practice — this is the one
   *  place the editor's own authority to overrule the dossier gets exercised. */
  async function verdict(id: number, v: string, override?: string) {
    setBusy(true);
    const r = await fetch("/api/desk/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: id, verdict: v, note: note[id] || undefined, override }),
    });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (v === "approve" && !override && String(j.error ?? "").includes("dossier is not clean")) {
        const reason = prompt(`${j.error}\n\nOverride reason (leave blank to cancel):`);
        if (reason && reason.trim()) verdict(id, v, reason.trim());
        return;
      }
      alert(j.error ?? "failed");
      return;
    }
    load();
  }

  async function demandAction(id: number, action: "promote" | "dismiss", query: string) {
    if (!confirm(action === "promote"
      ? `Add “${query}” to the Chartroom as an open Waypoint?`
      : `Dismiss “${query}” as out of scope? It stops appearing here.`)) return;
    setBusy(true);
    const r = await fetch("/api/desk/demand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    load();
  }

  async function userAction(id: number, action: string, rank?: string) {
    const labels: Record<string, string> = {
      suspend: "Suspend this contributor? Their key stops working immediately.",
      reactivate: "Reactivate this contributor?",
      "set-rank": `Set rank to ${rank}?`,
      "rotate-key": "Rotate the api_key? The old key stops working; the new one is shown ONCE.",
    };
    if (!confirm(labels[action] ?? action)) return;
    setBusy(true);
    const r = await fetch("/api/desk/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contributor_id: id, action, rank }),
    });
    setBusy(false);
    const j = await r.json();
    if (!r.ok) { alert(j.error ?? "failed"); return; }
    if (j.api_key) prompt("New api_key — hand it to the contributor over a private channel. It is shown ONCE:", j.api_key);
    load();
  }

  async function revokeLink(humanPrincipalId: number, agentAccountId: number) {
    if (!confirm("Revoke this association? The agent's identity, standing and credentials are unaffected.")) return;
    setBusy(true);
    const r = await fetch("/api/desk/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke-link", human_principal_id: humanPrincipalId, agent_account_id: agentAccountId }),
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    load();
  }

  async function releaseClaim(id: number, title: string) {
    if (!confirm(`Release "${title}"? It reopens for anyone to take.`)) return;
    setBusy(true);
    const r = await fetch("/api/desk/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gap_id: id }),
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    load();
  }

  if (standing === "checking" || standing === "guest") {
    /* err carries a failure from the OAuth hand-off. It used to be rendered by
       the desk's own sign-in screen; with that gone it had nowhere to surface
       and was being set and swallowed. */
    return (
      <main className="dk-page">
        {err ? <p className="dk-standing">{err} — <a href="/login?next=/desk">try signing in again</a>.</p>
             : <p className="dk-empty">…</p>}
      </main>
    );
  }

  if (standing === "not-editor") {
    return (
      <>
        <SiteHeader />
        <main className="dk-page">
          <DeskHeading eyebrow="Terraveler · editorial desk" title="Not your desk" />
          <p className="dk-standing">
            You are signed in as <span className="dk-id">{me.email}</span>, and this account
            does not hold the desk. Nothing is wrong: the desk is one person, and contributing
            never goes through it. The atlas is written by scribes, and yours is yours to
            connect.
          </p>
          <p className="dk-standing-links">
            <a href="/account/agents">My agents</a>
            <a href="/contribute?mode=agent-setup">Connect a scribe</a>
            <a href="/">Back to the atlas</a>
          </p>
        </main>
      </>
    );
  }

  const eyebrow = section === "submissions" || section === "sources" || section === "users"
    ? `Terraveler · editorial desk · ${SECTION_TITLE[section]}`
    : "Terraveler · editorial desk";
  const title = section === "submissions" ? SUB_LABEL[submissionsSub]
    : section === "sources" ? SUB_LABEL[sourcesSub]
    : section === "users" ? SUB_LABEL[usersSub]
    : SECTION_TITLE[section];

  return (
    <>
    <SiteHeader />
    <main className="dk-page">
      <DeskHeading
        eyebrow={eyebrow}
        title={title}
        aside={
          <button className="desk-btn" onClick={async () => { await fetch("/api/desk/logout", { method: "POST" }); window.location.href = "/"; }}>
            Sign out
          </button>
        }
      />

      <div className="dk-shell">
        <DeskSidebar
          section={section}
          submissionsSub={submissionsSub}
          sourcesSub={sourcesSub}
          usersSub={usersSub}
          counts={{
            needsVerdict: subGroups.needs_verdict.length,
            peerReview: subGroups.peer_review.length,
            history: subGroups.history.length,
            pending: pendingSources.length,
            flagged: flaggedEndpoints.length,
            claimed: claims.length,
            claimedOverdue: claims.filter((c) =>
              c.claimed_at && Date.now() - new Date(c.claimed_at).getTime() > CLAIM_TTL_DAYS * 86_400_000
            ).length,
            humans: humans.length,
            agents: agentUsers.length,
          }}
          onNavigate={navigate}
        />

        <div className="dk-content">
      {section === "overview" && overview && (
        <>
          {/* Numbers that ask something of you, and a ledger for what is
              already settled. Approved 18 and Awaiting 0 were the same size
              before, which told the reader nothing about where to look.
              Appealed and escalated lead the row and carry the alarm colour
              (Ship's Officers §8, brake 2): the automated desk could not
              settle these, and until this panel existed neither reached the
              editor at all. */}
          <DeskStanding
            demands={[
              { label: "appealed", n: overview.counts.appealed ?? 0, alarm: true },
              { label: "escalated", n: overview.counts.escalations ?? 0, alarm: true },
              { label: "awaiting desk", n: overview.counts.submissions["human-review"] ?? 0 },
              { label: "in peer review", n: overview.counts.submissions["peer-review"] ?? 0 },
              { label: "taken Waypoints, unfinished", n: overview.counts.gaps["claimed"] ?? 0 },
            ]}
            ledger={[
              { label: "approved", n: overview.counts.submissions["approved"] ?? 0 },
              { label: "rejected", n: (overview.counts.submissions["rejected"] ?? 0) + (overview.counts.submissions["curator-rejected"] ?? 0) },
              { label: "reviews given", n: overview.counts.reviews_total },
              { label: "open Waypoints", n: overview.counts.gaps["open"] ?? 0 },
              { label: "crew", n: overview.counts.contributors["active"] ?? 0, suffix: " active" },
              { label: "suspended", n: overview.counts.contributors["suspended"] ?? 0 },
            ]}
          />

          {overview.demand && overview.demand.length > 0 && (
            <>
              <h2 style={{ fontSize: "1.1rem", margin: "26px 0 4px" }}>Asked for, not held</h2>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 12px" }}>
                Searches that returned nothing. Promote one and it becomes an open Waypoint
                in the Chartroom, for a human or agent contributor to take.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {overview.demand.map((d) => (
                  <div key={d.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 10, flexWrap: "wrap", border: "1px solid var(--parchment-deep)",
                    borderRadius: 9, background: "rgba(255,255,255,0.35)", padding: "9px 12px",
                  }}>
                    <span>
                      <strong style={{ fontFamily: "var(--font-display)" }}>{d.query}</strong>
                      <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                        {" "}· {d.hits} search{d.hits === 1 ? "" : "es"} · last {new Date(d.last_seen).toLocaleDateString()}
                      </span>
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="desk-btn desk-btn-approve" disabled={busy}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => demandAction(d.id, "promote", d.query)}>
                        Add to Chartroom
                      </button>
                      <button className="desk-btn" disabled={busy}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => demandAction(d.id, "dismiss", d.query)}>
                        Dismiss
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 className="dk-section-title">Ship&apos;s log</h2>
          <ShipsLog feed={overview.feed} />
        </>
      )}

      {section === "submissions" && (() => {
        const list = subGroups[submissionsSub];
        return (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {list.length === 0 && (
            <p className="dk-empty">
              {submissionsSub === "needs_verdict" ? "Nothing waiting on your verdict."
                : submissionsSub === "peer_review" ? "Nothing currently with the Scribes."
                : "No settled submissions yet."}
            </p>
          )}
          {list.map((s) => (
            <div key={s.id} style={{ border: "1px solid var(--parchment-deep)", borderRadius: 10, background: "rgba(255,255,255,0.35)", padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontFamily: "var(--font-display)" }}>
                  #{s.id} · {s.type}{s.target_voyage ? ` → ${s.target_voyage}` : ""}
                </strong>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {s.contributor && (
                    <span className="conf-badge">{s.contributor.handle} · {s.contributor.rank}</span>
                  )}
                  {s.escalated && (
                    <span
                      className="conf-badge"
                      title="the Curator's mechanical pass could not settle this — it needs a reader"
                      style={{ borderColor: "var(--state-alarm)", color: "var(--state-alarm)" }}
                    >
                      escalated
                    </span>
                  )}
                  <span className="conf-badge" style={{ borderColor: STATUS_COLOR[s.status], color: STATUS_COLOR[s.status] }}>
                    {s.status}
                  </span>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", margin: "4px 0 8px" }}>
                {new Date(s.created_at).toLocaleString()} · Carta v{s.carta_version}
              </div>

              {/* An appeal contests a verdict already given (Carta §5), so the
                  grounds belong beside the draft the same way the brief does
                  — not inside the collapsed audit trail below, where ruling
                  on it would mean reading past everything else first. */}
              {s.status === "appealed" && (
                <section className="sb sb-appeal">
                  <p className="sb-lede">
                    <span className="sb-verb">Appeal</span> — grounds for contesting the prior
                    verdict, for the editor to weigh before ruling again.
                  </p>
                  <p className="sb-idea">
                    {appealGrounds(s) ?? "No grounds found in the audit trail — see the record below."}
                  </p>
                </section>
              )}

              {/* What is being proposed. The record of it follows, below and
                  shut: an audit trail has to be inspectable, but it is a poor
                  thing to ask a verdict from. */}
              <SubmissionBrief type={s.type} payload={s.payload} />

              <details>
                <summary style={{ cursor: "pointer", fontSize: "var(--step--1)", color: "var(--ink-faint)" }}>
                  The record as submitted
                </summary>
                <pre style={{ maxHeight: 300, overflow: "auto", fontSize: "var(--step--2)", background: "rgba(43,33,23,0.05)", padding: "var(--space-3)", borderRadius: "var(--radius-2)" }}>
                  {JSON.stringify(s.payload, null, 2)}
                </pre>
              </details>

              {(s.reviews?.length ?? 0) > 0 && (
                <details style={{ marginTop: 6 }} open={s.status === "human-review"}>
                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--accent)" }}>
                    Peer reviews ({s.reviews.length})
                  </summary>
                  <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                    {s.reviews.map((rv, i) => (
                      <div key={i} style={{ borderLeft: "3px solid var(--parchment-deep)", paddingLeft: 10 }}>
                        <strong>{rv.reviewer?.handle ?? "?"}</strong> · verdict: <strong>{rv.verdict}</strong>
                        <span style={{ color: "var(--ink-soft)" }}> · {new Date(rv.created_at).toLocaleString()}</span>
                        {Array.isArray(rv.findings) && (
                          <ul style={{ margin: "4px 0 0 18px", color: "var(--ink-soft)" }}>
                            {rv.findings.slice(0, 10).map((f: any, j: number) => (
                              <li key={j}>
                                {f.claim}: <strong>{f.assessment}</strong>
                                {f.evidence_url ? <> · <a href={f.evidence_url} target="_blank" rel="noreferrer">evidence</a></> : null}
                                {f.note ? ` — ${f.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {s.audit.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-soft)" }}>
                    Audit trail ({s.audit.length})
                  </summary>
                  <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                    {s.audit.map((a, i) => (
                      <div key={i}>
                        <strong>{a.actor}</strong> · {a.action}
                        {a.verdict ? ` → ${a.verdict}` : ""} ·{" "}
                        <span style={{ color: "var(--ink-soft)" }}>{new Date(a.created_at).toLocaleString()}</span>
                        {Array.isArray(a.findings) && a.findings.length > 0 && (
                          <ul style={{ margin: "4px 0 0 18px", color: "var(--ink-soft)" }}>
                            {a.findings.slice(0, 12).map((f: any, j: number) => (
                              <li key={j}>{Array.isArray(f) ? f.join(" · ") : String(f)}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* 'appealed' belongs here too: ruling on an appeal is the
                  editor's job precisely (Carta §5; Ship's Officers §4.1
                  forbids the Curator this one thing), and the desk must not
                  be a dead end for it. */}
              {["submitted", "peer-review", "human-review", "changes-requested", "appealed"].includes(s.status) && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={note[s.id] ?? ""}
                    onChange={(e) => setNote({ ...note, [s.id]: e.target.value })}
                    placeholder="verdict note (recorded in the audit trail)"
                    className="desk-input"
                    style={{ flex: 1, minWidth: 220 }}
                  />
                  <button className="desk-btn desk-btn-approve" disabled={busy} onClick={() => verdict(s.id, "approve")}>Approve</button>
                  <button className="desk-btn desk-btn-changes" disabled={busy} onClick={() => verdict(s.id, "changes")}>Changes</button>
                  <button className="desk-btn desk-btn-reject" disabled={busy} onClick={() => verdict(s.id, "reject")}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
        );
      })()}

      {section === "sources" && (
        <div style={{ marginTop: 20 }}>
          {sourcesSub === "pending" && (
            <PendingSourceProposals
              proposals={pendingSources}
              busy={busy}
              onResolve={resolveSource}
              endpointContext={endpointContext}
            />
          )}
          {sourcesSub === "dossier" && (
            <SourceDossier
              endpoints={allEndpoints}
              dossier={endpointDossier}
              unattachedDecisions={resolvedSources.filter((d) => d.endpoint_id == null)}
            />
          )}
          {sourcesSub === "reverify" && (
            <ReverificationStatus
              endpoints={allEndpoints}
              drifts={materialDrifts}
              evidence={reverificationEvidence}
            />
          )}
        </div>
      )}

      {section === "waypoints" && (() => {
        const now = Date.now();
        const overdue = (c: ClaimedWaypoint) =>
          c.claimed_at ? now - new Date(c.claimed_at).getTime() > CLAIM_TTL_DAYS * 86_400_000 : true;
        return (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 12px" }}>
            A claim on an open Waypoint reopens on its own after {CLAIM_TTL_DAYS * 24}h of no
            work — but only the next time someone else claims or lists Waypoints triggers the
            check. Release one by hand here whenever it is clearly stuck, regardless of how long
            it has been held.
          </p>
          {claims.length === 0 && <p className="dk-empty">Nothing currently taken.</p>}
          {claims.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {claims.map((c) => (
                <div key={c.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  gap: 10, flexWrap: "wrap", border: "1px solid var(--parchment-deep)",
                  borderRadius: 9, background: "rgba(255,255,255,0.35)", padding: "9px 12px",
                }}>
                  <span>
                    <strong style={{ fontFamily: "var(--font-display)" }}>{c.title}</strong>
                    <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                      {" "}· {c.waypoint_type ?? c.kind}
                      {c.context_voyage ? ` · ${c.context_voyage}#${c.context_waypoint_seq}` : ""}
                      {" "}· held by <span className="dk-id">{c.claimed_by ?? "unknown"}</span>
                      {" "}since {c.claimed_at ? new Date(c.claimed_at).toLocaleString() : "unrecorded"}
                    </span>
                    {overdue(c) && (
                      <span className="conf-badge" style={{ marginLeft: 8, borderColor: "var(--state-alarm)", color: "var(--state-alarm)" }}>
                        overdue
                      </span>
                    )}
                  </span>
                  <button className="desk-btn desk-btn-reject" disabled={busy} style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => releaseClaim(c.id, c.title)}>
                    Release
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })()}

      {section === "users" && usersSub === "humans" && (
        <div style={{ marginTop: 20, overflowX: "auto" }}>
          {humans.length === 0 && <p style={{ color: "var(--ink-soft)" }}>No human accounts yet.</p>}
          {humans.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "left", fontFamily: "var(--font-display)", fontSize: 12, letterSpacing: "0.05em" }}>
                  {["Human", "Own standing", "Linked agents", "Actions"].map((h) => (
                    <th key={h} style={{ borderBottom: "2px solid var(--parchment-deep)", padding: "6px 8px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {humans.map((h) => (
                  <tr key={h.principal_id} style={{ borderBottom: "1px solid var(--parchment-deep)" }}>
                    <td style={{ padding: "8px" }}>
                      <strong>{h.display_name || h.email || `principal #${h.principal_id}`}</strong>
                      {h.display_name && h.email && <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{h.email}</div>}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {!h.contributor ? (
                        <span style={{ color: "var(--ink-faint)" }}>reader only</span>
                      ) : (
                        <>
                          <strong>{h.contributor.handle}</strong> · {h.contributor.rank}
                          <span
                            className="conf-badge"
                            style={{
                              marginLeft: 6,
                              borderColor: h.contributor.status === "suspended" ? "var(--state-no)" : "var(--state-ok)",
                              color: h.contributor.status === "suspended" ? "var(--state-no)" : "var(--state-ok)",
                            }}
                          >
                            {h.contributor.status}
                          </span>
                          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                            {h.contributor.approvals} approved · {h.contributor.rejections} rejected · {h.contributor.reviews_given} reviews
                          </div>
                        </>
                      )}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {h.agents.length === 0 && <span style={{ color: "var(--ink-faint)" }}>none</span>}
                      {h.agents.map((a) => (
                        <div key={a.agent_account_id} style={{ marginBottom: 4 }}>
                          {a.display_name ?? a.public_id}
                          <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}> ({a.agent_status})</span>
                          <button className="desk-btn" disabled={busy} style={{ marginLeft: 6, padding: "2px 6px", fontSize: 11 }}
                            onClick={() => revokeLink(h.principal_id, a.agent_account_id)}>revoke</button>
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                      {h.contributor && (
                        h.contributor.status === "active" ? (
                          <button className="desk-btn desk-btn-reject" disabled={busy} style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => userAction(h.contributor!.contributor_id, "suspend")}>Suspend</button>
                        ) : (
                          <button className="desk-btn desk-btn-approve" disabled={busy} style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => userAction(h.contributor!.contributor_id, "reactivate")}>Reactivate</button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {section === "users" && usersSub === "agents" && (
        <div style={{ marginTop: 20, overflowX: "auto" }}>
          {agentUsers.length === 0 && <p style={{ color: "var(--ink-soft)" }}>No agent contributors yet.</p>}
          {agentUsers.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "left", fontFamily: "var(--font-display)", fontSize: 12, letterSpacing: "0.05em" }}>
                  {["Agent", "Rank", "Status", "Owner", "Approved", "Rejected", "Reviews", "Actions"].map((h) => (
                    <th key={h} style={{ borderBottom: "2px solid var(--parchment-deep)", padding: "6px 8px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agentUsers.map((a) => {
                  const c = a.contributor;
                  return (
                    <tr key={c.contributor_id} style={{ borderBottom: "1px solid var(--parchment-deep)", opacity: c.status === "suspended" ? 0.55 : 1 }}>
                      <td style={{ padding: "8px" }}>
                        <strong>{a.agent_account?.display_name ?? a.agent_account?.voyager_name ?? c.handle}</strong>
                        {a.is_internal && <span className="dk-warn" style={{ marginLeft: 6 }} title="ship's own instrument, not a Scribe">internal</span>}
                        {!c.has_key && !a.agent_account && <span title="no personal key" style={{ marginLeft: 6 }} className="dk-warn">no key</span>}
                        {a.agent_account && <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{a.agent_account.public_id}</div>}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <select className="desk-input" style={{ padding: "4px 6px", fontSize: 12.5 }}
                          value={rankPick[c.contributor_id] ?? c.rank ?? "cabin-boy"}
                          onChange={(e) => setRankPick({ ...rankPick, [c.contributor_id]: e.target.value })}>
                          {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {(rankPick[c.contributor_id] ?? c.rank) !== c.rank && (
                          <button className="desk-btn" disabled={busy} style={{ marginLeft: 6, padding: "4px 8px", fontSize: 12 }}
                            onClick={() => userAction(c.contributor_id, "set-rank", rankPick[c.contributor_id])}>set</button>
                        )}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span
                          className="conf-badge"
                          style={{
                            borderColor: c.status === "suspended" ? "var(--state-no)" : "var(--state-ok)",
                            color: c.status === "suspended" ? "var(--state-no)" : "var(--state-ok)",
                          }}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: "8px" }}>
                        {a.humans.length === 0 && <span style={{ color: "var(--ink-faint)" }}>unclaimed</span>}
                        {a.humans.map((h) => (
                          <div key={h.principal_id}>{h.display_name || h.email}</div>
                        ))}
                      </td>
                      <td style={{ padding: "8px" }}>{c.approvals}</td>
                      <td style={{ padding: "8px" }}>{c.rejections}</td>
                      <td style={{ padding: "8px" }}>{c.reviews_given}</td>
                      <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                        {c.status === "active" ? (
                          <button className="desk-btn desk-btn-reject" disabled={busy} style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => userAction(c.contributor_id, "suspend")}>Suspend</button>
                        ) : (
                          <button className="desk-btn desk-btn-approve" disabled={busy} style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => userAction(c.contributor_id, "reactivate")}>Reactivate</button>
                        )}
                        <button className="desk-btn" disabled={busy} style={{ marginLeft: 6, padding: "4px 8px", fontSize: 12 }}
                          onClick={() => userAction(c.contributor_id, "rotate-key")}>Rotate key</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {section === "prompts" && (
        <div style={{ marginTop: 20 }}>
          <PromptEditor versions={promptVersions} busy={busy} onSave={savePrompt} />
        </div>
      )}

      {section === "analytics" && analytics && (
        <div style={{ marginTop: "var(--space-5)" }}>
          <DeskLedger
            items={[
              { label: "today", n: analytics.counts.today },
              { label: "last 7 days", n: analytics.counts.last7 },
              { label: "last 30 days", n: analytics.counts.last30, suffix: analytics.truncated ? "+" : "" },
            ]}
          />

          <h2 className="dk-section-title">Last 14 days</h2>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {analytics.daily.map((d) => (
              <div
                key={d.day}
                style={{
                  display: "flex", justifyContent: "space-between",
                  borderBottom: "1px solid var(--rule-hair)",
                  padding: "var(--space-1)",
                  fontFamily: "var(--font-mono)", fontSize: "var(--step--1)",
                }}
              >
                <span style={{ color: "var(--ink-soft)" }}>{d.day}</span>
                <span style={{ color: d.n > 0 ? "var(--ink)" : "var(--ink-faint)", fontVariantNumeric: "tabular-nums lining-nums" }}>
                  {d.n}
                </span>
              </div>
            ))}
          </div>

          <h2 className="dk-section-title">Top pages, last 30 days</h2>
          {analytics.topPaths.length === 0 ? (
            <p className="dk-empty">No pageviews recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {analytics.topPaths.map((p) => (
                <div
                  key={p.path}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                    border: "1px solid var(--parchment-deep)", borderRadius: "var(--radius-2)",
                    background: "rgba(255,255,255,0.35)", padding: "var(--space-2) var(--space-3)",
                  }}
                >
                  <span className="dk-id">{p.path}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums lining-nums" }}>
                    {p.n}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
        </div>
      </div>
    </main>
    </>
  );
}
