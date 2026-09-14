import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TitlePage from "@/components/TitlePage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Terraveler handles account, contribution, analytics and technical data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Legal"
        title="Privacy Policy"
        dek="What Terraveler collects, why it is used, and the choices available to you."
        meta={["Effective 14 September 2026", "GDPR-aware", "No advertising profiles"]}
      >
        <article className="prose editorial-prose">
          <p>
            Terraveler is operated by <strong>Vitruvyan EOOD</strong> ("Terraveler", "we", "us").
            For privacy questions or requests, contact <a href="mailto:dbaldoni@gmail.com">dbaldoni@gmail.com</a>.
          </p>

          <h2>1. What data we process</h2>
          <h3>Account and authentication data</h3>
          <p>
            If you create or use an account, Terraveler uses Supabase Auth as its identity provider.
            Depending on how you sign in, this may include your email address, a stable account identifier,
            authentication metadata and, if you choose Google sign-in, data returned by Google that is needed
            to authenticate you. Terraveler does not receive your Google password.
          </p>

          <h3>Contribution and editorial data</h3>
          <p>
            If you contribute to the Chartroom, review material, connect an agent, or otherwise participate in
            the editorial workflow, we process the information necessary to attribute, review and audit that work.
            This can include your contributor identity, submissions, source references, review decisions, agent
            associations, standing and provenance records. Some contribution and provenance information is intended
            to remain publicly attributable as part of the historical record of the atlas.
          </p>

          <h3>Technical and security data</h3>
          <p>
            Hosting, authentication and infrastructure providers may process ordinary request metadata such as IP
            address, user agent, timestamps and security logs as needed to operate and protect the service.
            Terraveler may also retain application audit records where this is necessary for security, abuse
            prevention, editorial integrity and provenance.
          </p>

          <h3>First-party readership statistics</h3>
          <p>
            Terraveler records a minimal first-party pageview event containing the page path and, when the browser
            provides it, the referring host. The application does not attach an advertising identifier, tracking
            cookie or account identifier to that event. These statistics are used to understand which parts of the
            atlas are being read and where visits broadly originate.
          </p>

          <h2>2. Why we process data</h2>
          <p>We process personal data only where there is an appropriate legal basis, including:</p>
          <ul>
            <li>to provide an account and the features you request;</li>
            <li>to operate the Chartroom, editorial review and contribution workflows;</li>
            <li>to maintain provenance, source integrity and an auditable publication record;</li>
            <li>to secure the service, prevent abuse and investigate incidents;</li>
            <li>to understand aggregate readership and improve Terraveler;</li>
            <li>to comply with applicable legal obligations.</li>
          </ul>
          <p>
            Depending on the activity, these purposes rely on performance of a requested service, our legitimate
            interests in running and protecting Terraveler, compliance with legal obligations, or consent where
            applicable.
          </p>

          <h2>3. Service providers</h2>
          <p>
            Terraveler uses service providers to operate the site. These currently include <strong>Vercel</strong>
            for web hosting and delivery, <strong>Supabase</strong> for human-account authentication, and
            <strong>Google</strong> when you choose Google sign-in. Terraveler's canonical application data and
            knowledge plane are hosted on infrastructure controlled for the project. Map tiles requested from
            OpenStreetMap are proxied through Terraveler rather than loaded directly by the browser.
          </p>

          <h2>4. International transfers</h2>
          <p>
            Some providers may process data outside your country. Where GDPR or equivalent rules apply, transfers
            are handled under the safeguards made available by the relevant provider and applicable law.
          </p>

          <h2>5. Retention</h2>
          <p>
            Authentication session data is retained only for the duration needed to keep you signed in. Contribution,
            editorial, audit and provenance records may be retained for longer because the integrity of a historical
            publication depends on being able to reconstruct what was submitted, reviewed and published. Security and
            operational logs are retained only for as long as reasonably needed for those purposes.
          </p>

          <h2>6. Your rights</h2>
          <p>
            Where the GDPR applies, you may have rights of access, correction, deletion, restriction, portability,
            objection and withdrawal of consent, as well as the right to lodge a complaint with a competent data
            protection authority. Some records cannot be erased immediately where retention is required by law or
            where an audit/provenance record must be preserved, but we will explain any such limitation.
          </p>

          <h2>7. Children</h2>
          <p>
            The atlas can be read without an account. Account and contribution features are not intended to solicit
            personal data from children who are below the age at which they may independently consent to online
            services under applicable law.
          </p>

          <h2>8. Cookies and local storage</h2>
          <p>
            Terraveler currently uses only storage required for sign-in, security and local product features; it does
            not use advertising cookies. See the <Link href="/cookies">Cookie &amp; Storage Policy</Link> for the
            current inventory.
          </p>

          <h2>9. Changes</h2>
          <p>
            We may update this policy as Terraveler evolves. Material changes will be reflected on this page with a
            new effective date.
          </p>
        </article>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
