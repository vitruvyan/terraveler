"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/Icon";
import "./AdminNavigation.css";

export type AdminArea = "dashboard" | "projects" | "team" | "workspace" | "administration";
export const ADMIN_PRIMARY = [
  { id: "dashboard", href: "/desk", label: "Editorial desk", icon: "compass" },
  { id: "projects", href: "/desk/projects", label: "Projects", icon: "map" },
  { id: "team", href: "/desk/team", label: "Agent team", icon: "mariner" },
  { id: "workspace", href: "/desk?tab=workspace", label: "Review & publish", icon: "quill" },
] as const;
type NavLink = { href: string; label: string; icon: IconName };
const GROUPS: { title: string; links: NavLink[] }[] = [
  { title: "Knowledge", links: [
    { href: "/desk?tab=content", label: "Content catalogue", icon: "scroll" },
    { href: "/desk?tab=sources&sub=dossier", label: "Source registry", icon: "antiquity" },
    { href: "/desk?tab=sources&sub=pending", label: "Source proposals", icon: "record" },
    { href: "/desk?tab=sources&sub=reverify", label: "Source checks", icon: "lens" },
    { href: "/desk?tab=submissions&sub=peer_review", label: "Agent reviews", icon: "check" },
  ] },
  { title: "Contributors", links: [
    { href: "/desk?tab=users&sub=humans", label: "Human contributors", icon: "mariner" },
    { href: "/desk?tab=users&sub=agents", label: "Agent contributors", icon: "dialogue" },
  ] },
  { title: "Operations", links: [
    { href: "/desk?tab=waypoints", label: "Claimed work", icon: "pin" },
    { href: "/desk?tab=overview", label: "Activity & requests", icon: "record" },
    { href: "/desk?tab=submissions&sub=history", label: "Decision history", icon: "hourglass" },
  ] },
  { title: "Settings", links: [
    { href: "/desk?tab=prompts", label: "System prompts", icon: "key" },
    { href: "/desk?tab=analytics", label: "Analytics", icon: "chart" },
    { href: "/specimen", label: "Design reference", icon: "plates" },
  ] },
];

export function AdminShell({ active, currentHref, children }: { active: AdminArea; currentHref?: string; children: ReactNode }) {
  const [compact, setCompact] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { try { setCompact(sessionStorage.getItem("terraveler.admin.compact") === "true"); } catch { /* storage may be disabled */ } }, []);
  const toggleCompact = () => { const next = !compact; setCompact(next); try { sessionStorage.setItem("terraveler.admin.compact", String(next)); } catch { /* keep in-memory preference */ } };
  return <div className="admin-shell" data-compact={compact}>
    <AdminNavigation active={active} currentHref={currentHref} compact={compact} onCompact={toggleCompact} mobileOpen={mobileOpen} onMobile={() => setMobileOpen(c => !c)} />
    <div className="admin-body">{children}</div>
  </div>;
}

export default function AdminNavigation({ active, currentHref, compact = false, onCompact, mobileOpen = false, onMobile }: { active: AdminArea; currentHref?: string; compact?: boolean; onCompact?: () => void; mobileOpen?: boolean; onMobile?: () => void }) {
  const menuId = useId();
  const destination = (link: NavLink, selected: boolean) => <a key={link.href} href={link.href} aria-label={link.label} aria-current={selected ? "page" : undefined} title={compact ? link.label : undefined}><Icon name={link.icon} /><span className="admin-nav-label">{link.label}</span></a>;
  return <nav className="admin-navigation" aria-label="Administration" data-mobile-open={mobileOpen}>
    <div className="admin-nav-head"><span className="admin-nav-label">Editorial studio</span>
      {onCompact && <button className="admin-collapse desk-btn" type="button" aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!compact} onClick={onCompact}><Icon name={compact ? "stage-next" : "stage-prev"} /></button>}
      {onMobile && <button className="admin-mobile-toggle desk-btn" type="button" aria-expanded={mobileOpen} aria-controls={menuId} onClick={onMobile}><Icon name="menu" /> {mobileOpen ? "Close menu" : "Open menu"}</button>}
    </div>
    <div className="admin-nav-scroll" id={menuId}>
      <div className="admin-nav-group"><p className="admin-nav-caption">Newsroom</p><div className="admin-primary">{ADMIN_PRIMARY.map(item => destination(item, active === item.id))}</div></div>
      {GROUPS.map(group => <div key={group.title} className="admin-nav-group"><p className="admin-nav-caption">{group.title}</p>{group.links.map(link => destination(link, currentHref === link.href))}</div>)}
      <div className="admin-nav-group admin-nav-exit">{destination({href:"/",label:"Return to the atlas",icon:"globe"},false)}</div>
    </div>
  </nav>;
}
