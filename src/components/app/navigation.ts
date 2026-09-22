import type { Capability } from "@/domain/identity/persona";

export const NAV_ICON_KEYS = [
  "layout-dashboard",
  "circle-dollar-sign",
  "route",
  "book-open",
  "bot",
  "briefcase",
  "hammer",
  "database",
  "lightbulb",
  "network",
  "award",
  "gauge",
  "users",
  "trending-up",
  "clipboard-check",
  "building-2",
  "landmark",
  "bar-chart-3",
] as const;

export type NavIconKey = (typeof NAV_ICON_KEYS)[number];

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  /** The capability that reveals this item. Nav mirrors authorization; it never widens it. */
  capability: Capability;
}

/**
 * Only routes that are actually implemented appear here.
 * Seeing a control never implies access; server actions and RLS
 * independently enforce the same capability.
 *
 * Icons are represented by serializable keys because this module is consumed
 * by a Server Component while NavLink is a Client Component.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard", capability: "profile.read_own" },
  { href: "/access", label: "Funding access", icon: "circle-dollar-sign", capability: "profile.read_own" },
  { href: "/pathway", label: "Pathway", icon: "route", capability: "profile.read_own" },
  { href: "/learn", label: "Learning catalog", icon: "book-open", capability: "profile.read_own" },
  { href: "/tutor", label: "AI tutor", icon: "bot", capability: "learner.dashboard.view" },
  { href: "/projects", label: "Projects", icon: "hammer", capability: "project.manage_own" },
  { href: "/contributions", label: "Data Corps", icon: "database", capability: "profile.read_own" },
  { href: "/challenges", label: "Challenges", icon: "lightbulb", capability: "project.manage_own" },
  { href: "/capabilities", label: "Capability graph", icon: "network", capability: "credential.read_own" },
  { href: "/portfolio", label: "Portfolio", icon: "award", capability: "credential.read_own" },
  { href: "/baseline/results", label: "Baseline", icon: "gauge", capability: "profile.read_own" },
  { href: "/opportunities", label: "Opportunities", icon: "briefcase", capability: "opportunity.apply_own" },
  { href: "/mentorship", label: "Mentorship", icon: "users", capability: "mentorship.request_own" },
  { href: "/outcomes", label: "Outcomes", icon: "trending-up", capability: "outcomes.read_own" },
  { href: "/review", label: "Review queue", icon: "clipboard-check", capability: "review.decide" },
  { href: "/organizations", label: "Organizations", icon: "building-2", capability: "organization.create" },
  { href: "/governance", label: "Flywheel governance", icon: "landmark", capability: "organization.manage" },
  { href: "/intelligence", label: "Intelligence", icon: "bar-chart-3", capability: "intelligence.read_org" },
];
