/* The specimen's own table of contents. One list, so a new chapter is added
   in one place rather than in four pages that then drift apart. */

const CHAPTERS = [
  { href: "/specimen", n: "i", label: "type" },
  { href: "/specimen/palette", n: "ii", label: "colour" },
  { href: "/specimen/mark", n: "iii", label: "mark" },
  { href: "/specimen/plates", n: "iv", label: "plates" },
];

export default function Chapters({ current }: { current: string }) {
  return (
    <nav className="spec-chapters">
      {CHAPTERS.map((c) => (
        <a
          key={c.href}
          className="spec-chapter"
          href={c.href}
          aria-current={c.href === current ? "page" : undefined}
        >
          {c.n} &middot; {c.label}
        </a>
      ))}
    </nav>
  );
}
