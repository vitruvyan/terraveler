import Link from "next/link";

/** Shared footer for editorial pages (About, Contribute, …).
 *  The map page stays full-bleed; company identity lives in its compass menu. */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>Terraveler</strong> — a{" "}
        <a href="https://vitruvyan.com" target="_blank" rel="noreferrer">
          Vitruvyan EOOD
        </a>{" "}
        company
      </div>
      <nav>
        <Link href="/">The voyage</Link>
        <Link href="/about">About</Link>
        <Link href="/contribute">Contribute</Link>
        <a href="https://github.com/vitruvyan/terraveler" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href="https://github.com/vitruvyan/terraveler/blob/main/MAGNA_CARTA.md" target="_blank" rel="noreferrer">
          The Magna Carta
        </a>
        <a href="mailto:dbaldoni@gmail.com">Contact</a>
      </nav>
      <div className="sf-copy">
        © {new Date().getFullYear()} Terraveler · Content CC BY-SA · Sources public domain / CC ·
        Built in the open, verified before publication.
      </div>
    </footer>
  );
}
