"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import AccountPanel from "@/components/AccountPanel";
import { ALL } from "@/lib/nav";

/* THE DOORS — the top-right cluster: the compass menu and the account.
 *
 * The second class of map chrome. A door takes you elsewhere, and every door
 * is the same dark material, round where it carries only an icon. Where they
 * lead is not a property of the map, so the list comes from lib/nav rather
 * than being spelled here — it was spelled here twice, once per experience,
 * and both copies went stale: the menu still offered /search after the
 * navigation reform removed it, and never gained /crew after the watch bill
 * shipped.
 *
 * The open/closed state is owned here because nothing outside the cluster ever
 * read it. The atlas door is not in this cluster — it belongs to the imprint,
 * where it says what you are looking at.
 */
export default function MapDoors() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);

  return (
    <div className="tr-cluster">
      <div style={{ position: "relative" }}>
        <button
          className="tr-btn"
          onClick={() => setMenuOpen((m) => !m)}
          aria-label="Menu"
          aria-expanded={menuOpen}
          title="Menu"
        >
          <Icon name="menu" size={19} />
        </button>
        {menuOpen && (
          <div className="tr-menu" onClick={() => setMenuOpen(false)}>
            {ALL.map((d) => (
              <a key={d.href} href={d.href}>
                {d.label}
              </a>
            ))}
            <div className="tr-menu-foot">
              Terraveler — a Vitruvyan EOOD company
              <br />
              <a href="mailto:dbaldoni@gmail.com">contact</a> ·{" "}
              <a href="https://vitruvyan.com" target="_blank" rel="noreferrer">
                vitruvyan.com
              </a>
            </div>
          </div>
        )}
      </div>
      <div className="acct-anchor">
        <button
          className="tr-btn"
          onClick={() => setAcctOpen((open) => !open)}
          title="Account"
          aria-label="Account"
          aria-expanded={acctOpen}
        >
          <Icon name="morion" size={23} />
        </button>
        <AccountPanel open={acctOpen} onClose={() => setAcctOpen(false)} />
      </div>
    </div>
  );
}
