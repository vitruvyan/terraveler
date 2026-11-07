import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TitlePage from "@/components/TitlePage";
import {
  briefParagraphs,
  fromProposal,
  loadProject,
  nextStep,
  stagesFor,
} from "@/lib/project";
import "./project.css";

/* One stable page per Ongoing Project.
 *
 * It exists so that approved work never looks like it has vanished: whoever
 * arrives — the editor, the author's agent in a new session, a reader — can
 * see what was asked, where it stands, who has to act next, and the record of
 * who decided what. Voices: the brief and the reasoning are the narrator
 * (serif); identifiers, commands, timestamps and verdicts are the machine
 * (mono). See .claude/skills/terraveler-design. */

export const revalidate = 60;

type Params = { params: Promise<{ id: string }> };

const KIND_LABEL: Record<string, string> = {
  voyage: "Voyage",
  waypoint: "Stop",
  media: "Images",
  perspective: "Perspective",
  translation: "Translation",
  correction: "Correction",
};

function when(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "—";
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const view = await loadProject(Number(id));
  if (!view) return { title: "Project not found" };
  return {
    title: `${view.project.title} — Ongoing Project`,
    description: "An Ongoing Project in the Chartroom: what was asked, where it stands, and who acts next.",
    alternates: { canonical: `/project/${view.project.id}` },
  };
}

export default async function ProjectPage({ params }: Params) {
  const { id } = await params;
  const view = await loadProject(Number(id));
  if (!view) notFound();

  const { project, trail, proposedAt } = view;
  const approved = trail.some((t) => t.action === "verdict" && t.verdict === "approve");
  const stages = stagesFor(view);
  const next = nextStep(project, approved);
  const brief = briefParagraphs(project.description);
  const origin = fromProposal(project);

  return (
    <>
      <SiteHeader />
      <main className="project-page">
        <TitlePage
          eyebrow={`Ongoing Project · ${KIND_LABEL[project.kind] ?? project.kind}`}
          title={project.title}
          dek={
            origin
              ? "Approved by the editor as work to be done. This is not yet a published voyage."
              : "Work the atlas is asking for. This is not yet a published voyage."
          }
          actions={[
            { href: "/contribute", label: "All Ongoing Projects", variant: "secondary" },
          ]}
          meta={[`Project #${project.id}`, origin ? `From proposal #${project.source_submission_id}` : "From the roadmap"]}
          wide
        >
          <article className="project-document">
            <section aria-labelledby="pj-stands">
              <h2 id="pj-stands">Where it stands</h2>
              <ol className="project-ladder">
                {stages.map((s) => (
                  <li key={s.key} className="project-stage" data-state={s.state}>
                    <span className="project-stage-label">{s.label}</span>
                    <span className="project-stage-note">{s.note}</span>
                  </li>
                ))}
              </ol>
              <p className="project-small">
                Drafts, peer review and publication are tracked on the submission itself, not yet
                on this page: a draft is followed with <code>get_submission_status</code>.
              </p>
            </section>

            <section aria-labelledby="pj-next">
              <h2 id="pj-next">Who acts next</h2>
              <div className="project-next">
                <p className="project-next-who">{next.who}</p>
                <p>{next.what}</p>
                {next.command && <pre className="project-command"><code>{next.command}</code></pre>}
              </div>
            </section>

            <section aria-labelledby="pj-brief">
              <h2 id="pj-brief">The brief</h2>
              {brief.length === 0 ? (
                <p className="project-small">No description was recorded for this project.</p>
              ) : (
                <>
                  {origin && (
                    <p className="project-small">
                      This is the proposal as it was approved. Any source named in it is a candidate until
                      a draft verifies it against the text; nothing here is yet evidence.
                    </p>
                  )}
                  <div className="project-brief">
                    {brief.map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                </>
              )}
            </section>

            {origin && (
              <section aria-labelledby="pj-record">
                <h2 id="pj-record">The record</h2>
                {trail.length === 0 && !proposedAt ? (
                  <p className="project-small">The proposal&rsquo;s record could not be read just now.</p>
                ) : (
                  <table className="project-record">
                    <thead>
                      <tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Carta</th></tr>
                    </thead>
                    <tbody>
                      {proposedAt && !trail.some((t) => t.action === "proposal") && (
                        <tr><td>{when(proposedAt)}</td><td>proposer</td><td>proposal #{project.source_submission_id} submitted</td><td>—</td></tr>
                      )}
                      {trail.map((t, i) => (
                        <tr key={i}>
                          <td>{when(t.created_at)}</td>
                          <td>{t.actor}</td>
                          <td>{t.verdict ? `${t.action}: ${t.verdict}` : t.action}</td>
                          <td>{t.carta_version ?? "—"}</td>
                        </tr>
                      ))}
                      {project.claimed_at && (
                        <tr><td>{when(project.claimed_at)}</td><td>{project.claimed_by ?? "a Voyager"}</td><td>project taken</td><td>—</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
                <p className="project-small">
                  Read the full audit with <code>get_audit {"{"} id: {project.source_submission_id} {"}"}</code>.{" "}
                  <Link href="/magna-carta">The Magna Carta</Link> says who may decide what.
                </p>
              </section>
            )}
          </article>
        </TitlePage>
      </main>
      <SiteFooter />
    </>
  );
}
