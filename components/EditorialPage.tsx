import type { ReactNode } from "react";

type EditorialAction = {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
};

type EditorialPageProps = {
  eyebrow: string;
  title: string;
  dek: string;
  background: string;
  credit?: string;
  children: ReactNode;
  actions?: EditorialAction[];
  meta?: string[];
  wide?: boolean;
};

export default function EditorialPage({
  eyebrow,
  title,
  dek,
  background,
  credit,
  children,
  actions = [],
  meta = [],
  wide = false,
}: EditorialPageProps) {
  return (
    <main className="ed-page">
      <section className="ed-hero" style={{ backgroundImage: `url(${background})` }}>
        <div className="ed-hero-shade" />
        <div className="ed-hero-inner">
          <span className="ed-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{dek}</p>
          {(actions.length > 0 || meta.length > 0) && (
            <div className="ed-hero-row">
              {actions.length > 0 && (
                <div className="ed-actions">
                  {actions.map((action) => (
                    <a
                      key={action.href}
                      className={`ed-action ${action.variant === "secondary" ? "secondary" : "primary"}`}
                      href={action.href}
                    >
                      {action.label}
                    </a>
                  ))}
                </div>
              )}
              {meta.length > 0 && (
                <div className="ed-meta" aria-label="Page facts">
                  {meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {credit && <div className="ed-credit">{credit}</div>}
      </section>
      <div className={`ed-body${wide ? " wide" : ""}`}>{children}</div>
    </main>
  );
}
