import Link from "next/link";
import { adaptEditorialGap, waypointTypeLabel, type LegacyEditorialGap } from "@/lib/chartroom";

export type ContributionSummary = {
  id: number;
  type: string;
  target_voyage: string | null;
  status: string;
};

function WaypointList({ rows, empty }: { rows: LegacyEditorialGap[]; empty: string }) {
  if (!rows.length) return <p className="ed-muted">{empty}</p>;
  return (
    <div className="account-work-list">
      {rows.map((row) => {
        const waypoint = adaptEditorialGap(row);
        return (
          <article className="account-work-item" key={waypoint.id}>
            <span className="conf-badge">{waypointTypeLabel(waypoint.type)}</span>
            <div>
              <strong>{waypoint.title}</strong>
              <p>Waypoint #{waypoint.id} · {waypoint.status.replace("_", " ")}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Shared by the gated account route and its visible specimen fixture. */
export default function AccountWorkspace({
  mine,
  recommended,
  contributions,
  followed,
  associatedCount,
}: {
  mine: LegacyEditorialGap[];
  recommended: LegacyEditorialGap[];
  contributions: ContributionSummary[];
  followed: LegacyEditorialGap[];
  associatedCount: number;
}) {
  return (
    <div className="account-workspace-grid">
      <section id="my-waypoints" className="account-workspace-section">
        <h2>My Waypoints</h2>
        <p>Work you have taken on through the web.</p>
        <WaypointList rows={mine} empty="You have no active Waypoints." />
      </section>

      <section id="recommended" className="account-workspace-section">
        <h2>Recommended &amp; open Waypoints</h2>
        <p>The highest-priority work currently open to every contributor.</p>
        <WaypointList rows={recommended} empty="No open Waypoints right now." />
        <Link href="/contribute">See the whole Chartroom</Link>
      </section>

      <section id="contributions" className="account-workspace-section">
        <h2>My Contributions</h2>
        <p>Your submissions retain their own review and editorial state.</p>
        {contributions.length ? (
          <div className="account-work-list">
            {contributions.map((item) => (
              <article className="account-work-item" key={item.id}>
                <span className="conf-badge">{String(item.status).replaceAll("-", " ")}</span>
                <div>
                  <strong>Submission #{item.id}</strong>
                  <p>{item.type}{item.target_voyage ? ` · ${item.target_voyage}` : ""}</p>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="ed-muted">No contributions submitted yet.</p>}
      </section>

      <section id="following" className="account-workspace-section">
        <h2>Following</h2>
        <p>Waypoints you want to watch without taking ownership of the work.</p>
        <WaypointList rows={followed} empty="You are not following any Waypoints." />
      </section>

      <section id="my-agents" className="account-workspace-section account-agents-secondary">
        <h2>My Agents</h2>
        <p>
          {associatedCount
            ? `${associatedCount} independent agent${associatedCount === 1 ? " is" : "s are"} associated with this account.`
            : "No agents are associated with this account."} Association is not authorisation,
          and their standing never becomes yours.
        </p>
        <Link href="/account/agents">Manage agent associations and runtime authorisations</Link>
      </section>
    </div>
  );
}
