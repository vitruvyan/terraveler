import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TitlePage from "@/components/TitlePage";

export const metadata: Metadata = {
  title: "Data Deletion",
  description: "How to request deletion of your Terraveler account and personal data.",
  alternates: { canonical: "/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Privacy"
        title="Delete your data"
        dek="How to request deletion of your Terraveler account and personal data."
        meta={["Public instructions", "Human accounts", "Effective 14 September 2026"]}
      >
        <article className="prose editorial-prose">
          <p>
            Terraveler is operated by <strong>Vitruvyan EOOD</strong>. You may request deletion of
            your Terraveler account and personal data at any time.
          </p>

          <h2>How to request deletion</h2>
          <p>
            Send an email to <a href="mailto:dbaldoni@gmail.com?subject=Terraveler%20data%20deletion%20request">dbaldoni@gmail.com</a>
            from the email address associated with your Terraveler account. Use the subject
            <strong> “Terraveler data deletion request”</strong> and state that you want your account
            and associated personal data deleted.
          </p>
          <p>
            If you can no longer access the email address associated with the account, contact us
            at the same address and provide enough information for us to verify that the request
            concerns your account without asking you for unnecessary personal data.
          </p>

          <h2>What we delete</h2>
          <p>Once the request has been verified, we will delete or disconnect personal data that is no longer necessary, including:</p>
          <ul>
            <li>your human account and authentication identity;</li>
            <li>active sessions and refresh credentials;</li>
            <li>personal account-to-agent associations that are no longer required;</li>
            <li>other account data that is not needed for legal, security, editorial-integrity or provenance purposes.</li>
          </ul>

          <h2>What may be retained</h2>
          <p>
            Terraveler is an evidence-led publication with an auditable editorial history. If your
            account has contributed material that has been reviewed or published, some contribution,
            provenance, moderation or security records may need to remain so that the integrity of the
            atlas can still be reconstructed. Where possible and appropriate, personal identifiers in
            those retained records will be removed, anonymised or pseudonymised rather than preserving
            information that is no longer necessary.
          </p>
          <p>
            We may also retain information where applicable law requires it, or where a limited record
            is necessary to establish, exercise or defend legal claims, prevent abuse, or preserve the
            integrity of a publication audit trail.
          </p>

          <h2>Timing</h2>
          <p>
            We will acknowledge a deletion request and handle it without undue delay. Where GDPR applies,
            requests are handled within the periods required by applicable data-protection law, subject
            to any lawful extension or exception.
          </p>

          <h2>Questions</h2>
          <p>
            For questions about deletion, privacy or your data, contact
            <a href="mailto:dbaldoni@gmail.com"> dbaldoni@gmail.com</a>. You can also read the
            <Link href="/privacy"> Privacy Policy</Link> and
            <Link href="/cookies"> Cookie &amp; Storage Policy</Link>.
          </p>
        </article>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
