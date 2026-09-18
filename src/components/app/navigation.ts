import { Building2, LayoutDashboard, type LucideIcon } from "lucide-react";
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
  { href: "/organizations", label: "Organizations", icon: Building2, capability: "organization.create" },
];
