import {
  Award,
  CircleDollarSign,
  Database,
  Lightbulb,
  Network,
  Building2,
  Bot,
  Briefcase,
  ClipboardCheck,
  Gauge,
  Hammer,
  LayoutDashboard,
  Route,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Capability } from "@/domain/identity/persona";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The capability that reveals this item. Nav mirrors authorization; it never widens it. */
  capability: Capability;
}

/**
 * Only routes that are actually implemented appear here. A persona never sees a
 * control that does nothing, and seeing a control never implies access — the
 * server action and RLS check the same capability again.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, capability: "profile.read_own" },
  { href: "/access", label: "Funding access", icon: CircleDollarSign, capability: "profile.read_own" },
  { href: "/pathway", label: "Pathway", icon: Route, capability: "profile.read_own" },
  { href: "/tutor", label: "AI tutor", icon: Bot, capability: "learner.dashboard.view" },
  { href: "/projects", label: "Projects", icon: Hammer, capability: "project.manage_own" },
  { href: "/contributions", label: "Data Corps", icon: Database, capability: "profile.read_own" },
  { href: "/challenges", label: "Challenges", icon: Lightbulb, capability: "project.manage_own" },
  { href: "/capabilities", label: "Capability graph", icon: Network, capability: "credential.read_own" },
  { href: "/portfolio", label: "Portfolio", icon: Award, capability: "credential.read_own" },
  { href: "/baseline/results", label: "Baseline", icon: Gauge, capability: "profile.read_own" },
  { href: "/opportunities", label: "Opportunities", icon: Briefcase, capability: "opportunity.apply_own" },
  { href: "/mentorship", label: "Mentorship", icon: Users, capability: "mentorship.request_own" },
  { href: "/outcomes", label: "Outcomes", icon: TrendingUp, capability: "outcomes.read_own" },
  { href: "/review", label: "Review queue", icon: ClipboardCheck, capability: "review.decide" },
  { href: "/organizations", label: "Organizations", icon: Building2, capability: "organization.create" },
];
