import { ArrowRight, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROBES_PER_COMPETENCY } from "@/domain/diagnostic/attempt";
import type { DiagnosticRow } from "@/lib/db/types";

export function BaselineStart({
  diagnostic,
  competencyCount,
  action,
}: {
  diagnostic: DiagnosticRow;
  competencyCount: number;
  action: () => Promise<void>;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <span className="grid size-10 place-items-center rounded-xl bg-white/6 text-accent">
            <Gauge className="size-5" aria-hidden />
          </span>
          <CardTitle className="mt-2 text-xl">{diagnostic.title}</CardTitle>
          <CardDescription>{diagnostic.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <dt className="text-xs text-ink-subtle">Competencies</dt>
              <dd className="mt-0.5 tabular-nums text-ink">{competencyCount}</dd>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <dt className="text-xs text-ink-subtle">Questions each</dt>
              <dd className="mt-0.5 tabular-nums text-ink">{PROBES_PER_COMPETENCY}</dd>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
              <dt className="text-xs text-ink-subtle">You can stop</dt>
              <dd className="mt-0.5 text-ink">Anytime</dd>
            </div>
          </dl>
          <p className="text-sm text-ink-subtle">
            Your answers are graded on our side, and the result is a level per competency rather
            than a score out of ten. Leave and come back — your place is saved.
          </p>
          <form action={action}>
            <Button type="submit">
              Start the baseline <ArrowRight className="size-4" aria-hidden />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
