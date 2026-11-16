import "./AdminNavigation.css";

export type AdminArea = "dashboard" | "projects" | "team" | "workspace" | "administration";
export const ADMIN_PRIMARY = [
  { id: "dashboard", href: "/desk", label: "Editorial desk" },
  { id: "projects", href: "/desk/projects", label: "Projects" },
  { id: "team", href: "/desk/team", label: "Agent team" },
  { id: "workspace", href: "/desk?tab=workspace", label: "Review & publish" },
] as const;
const TOOLS = [
  { title: "Content & evidence", links: [
    { href: "/desk?tab=content", label: "Content catalogue" },
    { href: "/desk?tab=sources&sub=dossier", label: "Source registry" },
    { href: "/desk?tab=sources&sub=pending", label: "Pending source proposals" },
    { href: "/desk?tab=sources&sub=reverify", label: "Source checks" },
    { href: "/desk?tab=submissions&sub=peer_review", label: "Agent reviews" },
  ] },
  { title: "People & operations", links: [
    { href: "/desk?tab=users&sub=humans", label: "Human contributors" },
    { href: "/desk?tab=users&sub=agents", label: "Agent contributors" },
    { href: "/desk?tab=waypoints", label: "Claimed work" },
    { href: "/desk?tab=overview", label: "Activity & requests" },
    { href: "/desk?tab=submissions&sub=history", label: "Decision history" },
  ] },
  { title: "Settings & reference", links: [
    { href: "/desk?tab=prompts", label: "System prompts" },
    { href: "/desk?tab=analytics", label: "Analytics" },
    { href: "/specimen", label: "Design reference" },
  ] },
];
export default function AdminNavigation({ active, currentHref }: { active: AdminArea; currentHref?: string }) {
  return <nav className="admin-navigation" aria-label="Administration">
    <div className="admin-primary">{ADMIN_PRIMARY.map(item => <a key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined}>{item.label}</a>)}</div>
    <details className="admin-more" open={active === "administration"}>
      <summary>More administration</summary>
      <p className="admin-nav-note">Evidence, contributor accounts and occasional platform settings.</p>
      <div className="admin-tools">{TOOLS.map(group => <section key={group.title}><h2>{group.title}</h2>{group.links.map(link => <a key={link.href} href={link.href} aria-current={currentHref === link.href ? "page" : undefined}>{link.label}</a>)}</section>)}</div>
    </details>
  </nav>;
}
