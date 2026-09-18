import Link from "next/link";
import { Bell, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { NAV_ITEMS } from "./navigation";
import { NavLink } from "./nav-link";
import { SignOutButton } from "./sign-out-button";
import { can, personasOf } from "@/domain/identity/actor";
import type { Actor } from "@/domain/identity/actor";
import { PERSONA_LABELS } from "@/domain/identity/persona";
import { initials } from "@/lib/utils";

export function AppShell({
  actor,
  unreadCount,
  children,
}: {
  actor: Actor;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const items = NAV_ITEMS.filter((item) => can(actor, item.capability));
  const personas = personasOf(actor);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-xl bg-brand/20 text-brand ring-1 ring-brand/40">
            <Sparkles className="size-4" aria-hidden />
          </span>
          BTG AI
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {items.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
          ))}
        </nav>
        <div className="mt-auto glass rounded-2xl p-4">
          <p className="text-xs font-medium text-ink-muted">Your personas</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {personas.map((persona) => (
              <Badge key={persona} tone={persona === actor.primaryPersona ? "brand" : "neutral"}>
                {PERSONA_LABELS[persona]}
              </Badge>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <header className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <nav aria-label="Main" className="flex items-center gap-1 lg:hidden">
            {items.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} compact />
            ))}
          </nav>
          <p className="hidden truncate text-sm text-ink-muted lg:block">
            Signed in as <span className="text-ink">{actor.displayName}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={`Notifications, ${unreadCount} unread`}>
              <Link href="/dashboard#notifications" className="relative">
                <Bell className="size-4" aria-hidden />
                {unreadCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" aria-hidden />
                ) : null}
              </Link>
            </Button>
            <span
              className="grid size-9 place-items-center rounded-full bg-brand/20 text-xs font-semibold text-ink ring-1 ring-brand/35"
              aria-hidden
            >
              {initials(actor.displayName)}
            </span>
            <SignOutButton />
          </div>
        </header>

        <main id="main" className="animate-rise flex-1 pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
