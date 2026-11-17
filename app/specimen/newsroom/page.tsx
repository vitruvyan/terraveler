import type { Metadata } from "next";
import Chapters from "../Chapters";
import { AdminShell } from "@/components/desk/AdminNavigation";
import { AdminDashboardView } from "@/components/desk/AdminDashboard";
import { DeskHeading } from "@/components/desk/Quarterdeck";
import type { AdminDashboardData } from "@/lib/adminDashboard";
import "../specimen.css";
import "../../desk/editorial.css";

export const metadata: Metadata = { title: "Newsroom specimen" };
const fixture: AdminDashboardData = {
  checked_at: "2026-11-17T09:00:00Z", execution_configured: false, worker_health: "not-observed",
  gateway: { status: "ready", models: ["example-model"] },
  projects: [
    { id: 25, title: "Cabeza de Vaca and Estebanico", state: "awaiting-editor", next_step: "Read the saved draft.", running: 0 },
    { id: 26, title: "The first circumnavigation", state: "researching", next_step: "Check the primary account.", running: 1 },
    { id: 27, title: "A voyage awaiting evidence", state: "attention", next_step: "Inspect the missing source.", running: 0 },
  ],
  agents: [{ name: "Historical researcher", role: "research", model: "example-model", enabled: true, version: 1 }],
  drafts: [{ result_id: 44, topic_id: 25, title: "From conquest to survival", created_at: "2026-11-17T08:00:00Z" }],
  publication: { awaiting_decision: 1 }, atlas: [], errors: [],
};
export default function NewsroomSpecimen() {
  return <>
    <div className="dk-page"><Chapters current="/specimen/newsroom" /><h1 className="dk-title">The newsroom</h1>
    <p>Illustrative records, not live platform data. The institutional voice labels the controls; the machine prints figures and timestamps. Brass marks the current page and the editor's priorities. The same sidebar, metrics and dashboard view render in production. The sidebar folds on narrow screens; links point to real desk destinations.</p></div>
    <AdminShell active="dashboard"><section className="dk-page"><DeskHeading eyebrow="Terraveler · specimen · fixture" title="Editorial desk" /><AdminDashboardView data={fixture} /></section></AdminShell>
    <div className="dk-page"><h2>Empty and partial records</h2><p>Zero means nothing recorded. An unavailable record is not a healthy queue.</p>
      <AdminDashboardView data={{...fixture,projects:[],drafts:[],agents:null,publication:{awaiting_decision:0},errors:["Agent registry"]}} />
    </div>
  </>;
}
