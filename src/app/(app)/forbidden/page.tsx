import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { requireActor } from "@/server/services/actor";
import { personasOf } from "@/domain/identity/actor";
import { PERSONA_LABELS } from "@/domain/identity/persona";
import { BRAND_ROUTES } from "@/components/brand/brand";

export const metadata: Metadata = { title: "Access denied" };
export const dynamic = "force-dynamic";

/**
 * The branded access-denied state. It renders inside the app shell — the
 * visitor is signed in and keeps their navigation — and names the capability
 * that is missing rather than claiming the page does not exist.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const [{ need }, actor] = await Promise.all([searchParams, requireActor()]);
  const personas = personasOf(actor);

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldAlert className="size-5 text-warning" aria-hidden />
            You don&apos;t have access to this
          </CardTitle>
          <CardDescription>
            Your account is signed in, but it does not hold the permission this page needs. If that
            looks wrong, ask whoever administers your organization to grant it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {need ? (
            <p className="text-sm text-ink-muted">
              Required capability: <code className="font-mono text-xs text-ink">{need}</code>
            </p>
          ) : null}
          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-muted">What your account holds today</p>
            <div className="flex flex-wrap gap-1.5">
              {personas.map((persona) => (
                <Badge key={persona} tone={persona === actor.primaryPersona ? "brand" : "neutral"}>
                  {PERSONA_LABELS[persona]}
                </Badge>
              ))}
            </div>
          </div>
          <Button asChild variant="secondary">
            <Link href={BRAND_ROUTES.dashboard}>Back to your dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
