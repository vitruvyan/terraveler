import Link from "next/link";
import { PRIMARY, PROJECT } from "@/lib/nav";

/** Rich, full-width footer for editorial pages. */
export default function SiteFooter() {
  return (
    <footer className="site-footer2">
      <div className="sf-inner">
        <div className="sf-col sf-brandcol">
          <div className="wordmark sf-wordmark">Terraveler</div>
          <div className="sf-tag">
            An atlas of geo-history — authoritative, sourced, alive. Humans bring
            the ideas; AI writes; everything is verified before it sails.
          </div>
          <div className="sf-company">
            <strong>Terraveler</strong> is a{" "}
            <a href="https://vitruvyan.com" target="_blank" rel="noreferrer">
              Vitruvyan EOOD
            </a>{" "}
            company.
          </div>
        </div>
        {/* The same two groups the header makes, from the same list: what the
            site is and how to take part, then the project itself. This column
            was missing the crew entirely and About sat under Explore. */}
        <div className="sf-col">
          <h4>Explore</h4>
          {PRIMARY.map((d) => (
            <Link key={d.href} href={d.href}>
              {d.label}
            </Link>
          ))}
        </div>
        <div className="sf-col">
          <h4>Governance</h4>
          {PROJECT.map((d) => (
            <Link key={d.href} href={d.href}>
              {d.label}
            </Link>
          ))}
        </div>
        <div className="sf-col">
          <h4>Contact</h4>
          <a href="mailto:dbaldoni@gmail.com">Write to the desk</a>
          <a href="https://vitruvyan.com" target="_blank" rel="noreferrer">vitruvyan.com</a>
        </div>
      </div>
      <div className="sf-base">
        © {new Date().getFullYear()} Terraveler · Content CC BY-SA · Sources public
        domain / CC · Built in the open, verified before publication.
      </div>
    </footer>
  );
}
