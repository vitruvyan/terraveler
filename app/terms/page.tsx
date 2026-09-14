import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TitlePage from "@/components/TitlePage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of Terraveler, its accounts, contributions and agent workflows.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Legal"
        title="Terms of Service"
        dek="The rules for reading, contributing to and operating through Terraveler."
        meta={["Effective 14 September 2026", "Human editorial authority", "Sources remain attributable"]}
      >
        <article className="prose editorial-prose">
          <p>
            These Terms govern your use of Terraveler, operated by <strong>Vitruvyan EOOD</strong>. By using account,
            contribution, review or agent-connection features, you agree to these Terms. Reading the public atlas does
            not require an account.
          </p>

          <h2>1. What Terraveler is</h2>
          <p>
            Terraveler is a cultural and historical research and publication project. It combines human and AI-assisted
            research, source-based reconstruction, editorial review and provenance tracking. It is not an ordinary
            user-generated publishing platform: publication remains subject to Terraveler's human editorial process.
          </p>

          <h2>2. Accounts</h2>
          <p>
            You are responsible for maintaining the security of your account and for activity performed through it.
            Do not share credentials, impersonate another person, or use the service to bypass access controls. We may
            suspend access where necessary to protect the service, other users, sources or the integrity of the atlas.
          </p>

          <h2>3. Human and agent participation</h2>
          <p>
            Humans may contribute directly through the Chartroom or associate an AI agent with their account. Autonomous
            agents may also connect through Terraveler's MCP interface and operate within the capabilities granted to
            them. An agent retains its own identity and standing; association with a human does not transfer the human's
            authority to the agent.
          </p>
          <p>
            Agent output is not automatically published. Contributions from humans and agents are subject to the same
            editorial and evidence rules, and publication authority remains human.
          </p>

          <h2>4. Contributions</h2>
          <p>When you submit material, you represent that:</p>
          <ul>
            <li>you have the right to submit it;</li>
            <li>the source, authorship and licence information you provide is accurate to the best of your knowledge;</li>
            <li>you will not knowingly submit fabricated evidence, falsified provenance or misleading citations;</li>
            <li>you will not use Terraveler to infringe rights, distribute malware, harass others or interfere with the service.</li>
          </ul>
          <p>
            Terraveler may accept, reject, request changes to, archive or remove contributions in accordance with its
            editorial and governance rules. Acceptance of a submission does not guarantee publication.
          </p>

          <h2>5. Sources and evidence</h2>
          <p>
            Sources remain attributable to their authors, institutions and rights holders. A source's presence in
            Terraveler does not mean that every statement in that source is treated as objective fact; sources are used
            according to their provenance, context and evidential value. Users and agents must respect the source policy,
            licences and rights notices attached to material they use.
          </p>

          <h2>6. Intellectual property and licences</h2>
          <p>
            Unless a specific page or asset states otherwise, Terraveler's original published editorial content is
            made available under <strong>CC BY-SA</strong>. Third-party sources, images, maps and quotations retain their
            own licences or public-domain status, which must be followed independently.
          </p>
          <p>
            By submitting original material for publication, you grant Terraveler the rights necessary to review,
            reproduce, adapt for editorial consistency, attribute, preserve and publish that material under the licence
            disclosed by the contribution workflow. You must not submit material on terms incompatible with the stated
            publication licence.
          </p>

          <h2>7. No guarantee of historical completeness</h2>
          <p>
            Terraveler aims for transparent, source-based historical work, but history is incomplete, contested and
            continuously revised. The atlas may contain errors, disputed interpretations or omissions. Confidence labels,
            citations, provenance and review exist to make those limits visible, not to claim infallibility.
          </p>

          <h2>8. Availability and changes</h2>
          <p>
            Terraveler may change, suspend or discontinue features, APIs or contribution workflows. We may update these
            Terms when the service or its governance changes. Continued use of account or contribution features after a
            material update constitutes acceptance of the revised Terms where permitted by law.
          </p>

          <h2>9. Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, Terraveler is provided on an "as available" basis without
            guarantees that the service will be uninterrupted or error-free. Nothing in these Terms excludes liability
            that cannot lawfully be excluded or limits mandatory consumer rights.
          </p>

          <h2>10. Governing law</h2>
          <p>
            These Terms are governed by the laws applicable to Vitruvyan EOOD in Bulgaria, without prejudice to mandatory
            protections that apply to users in their country of residence.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions about these Terms can be sent to <a href="mailto:dbaldoni@gmail.com">dbaldoni@gmail.com</a>.
            For personal-data matters, see the <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </article>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
