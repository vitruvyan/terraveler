import Ornament from "@/components/Ornament";
import { plateFor } from "@/lib/plates";

/* A frontispiece, not a poster.
 *
 * EditorialPage opens every chapter the same way: a map blown up to full bleed,
 * darkened to about a third of its luminance, a white title over it, two
 * buttons and three pills. Stack four of those pages and you cannot tell them
 * apart — the treatment erases what made each map different, and none of the
 * four can actually be looked at.
 *
 * A printed atlas opens a chapter on paper: the cartouche, a rule, an ornament,
 * the dek. Then it shows the plate where a plate belongs — mounted, at a size
 * where you can read the lettering, carrying the caption and credit and licence
 * and source the plates chapter requires of every other image on this site.
 *
 * Same props as EditorialPage, so a page changes its mind in one line.
 */

type Action = { href: string; label: string; variant?: "secondary" };

export default function TitlePage({
  eyebrow,
  title,
  dek,
  background,
  actions = [],
  meta = [],
  children,
}: {
  eyebrow: string;
  title: string;
  dek?: string;
  /** Kept named `background` so the swap from EditorialPage is one word. It is
   *  no longer a background: it is the plate. */
  background?: string;
  credit?: string;
  actions?: Action[];
  meta?: string[];
  wide?: boolean;
  children: React.ReactNode;
}) {
  const plate = plateFor(background);

  return (
    <div className="tp-page">
      <header className="tp-head">
        <span className="tp-eyebrow">{eyebrow}</span>
        <h1 className="tp-title">{title}</h1>
        {dek && <p className="tp-dek">{dek}</p>}

        <Ornament name="break" className="tp-rule" />

        {(actions.length > 0 || meta.length > 0) && (
          <div className="tp-row">
            {actions.length > 0 && (
              <div className="tp-actions">
                {actions.map((a) => (
                  <a
                    key={a.href}
                    href={a.href}
                    className={`tp-action${a.variant === "secondary" ? " is-secondary" : ""}`}
                  >
                    {a.label}
                  </a>
                ))}
              </div>
            )}
            {meta.length > 0 && (
              <div className="tp-meta">
                {meta.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {plate && (
        <figure className="tp-plate">
          <div className="tp-plate-mount">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={plate.url} alt={plate.caption} />
          </div>
          <figcaption>
            <p className="tp-plate-cap">{plate.caption}</p>
            <div className="tp-plate-prov">
              <span>{plate.credit}</span>
              <span className="tp-sep">&middot;</span>
              <span>{plate.license}</span>
              <span className="tp-sep">&middot;</span>
              <a href={plate.source_url} rel="noreferrer">
                commons
              </a>
            </div>
          </figcaption>
        </figure>
      )}

      <div className="ed-body">{children}</div>
    </div>
  );
}
