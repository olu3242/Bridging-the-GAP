"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Gauge,
  Hammer,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  Network,
  Route,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIconKey } from "./navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIconKey, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "circle-dollar-sign": CircleDollarSign,
  route: Route,
  "book-open": BookOpen,
  bot: Bot,
  briefcase: Briefcase,
  hammer: Hammer,
  database: Database,
  lightbulb: Lightbulb,
  network: Network,
  award: Award,
  gauge: Gauge,
  users: Users,
  "trending-up": TrendingUp,
  "clipboard-check": ClipboardCheck,
  "building-2": Building2,
  landmark: Landmark,
  "bar-chart-3": BarChart3,
};

export function NavLink({
  href,
  label,
  icon,
  compact = false,
}: {
  href: string;
  label: string;
  icon: NavIconKey;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = ICONS[icon];

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
        active ? "bg-white/8 text-ink" : "text-ink-subtle hover:bg-white/5 hover:text-ink",
        compact && "px-2.5",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={cn(compact && "sr-only sm:not-sr-only")}>{label}</span>
    </Link>
  );
}
