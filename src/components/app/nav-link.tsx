"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function NavLink({
  href,
  label,
  icon: Icon,
  compact = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

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
