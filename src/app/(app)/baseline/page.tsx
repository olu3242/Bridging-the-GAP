import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BaselineFinish } from "@/components/app/baseline-finish";
import { BaselineQuestion } from "@/components/app/baseline-question";
import { BaselineStart } from "@/components/app/baseline-start";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import {
  countProbedCompetencies,
  getBaselineDiagnostic,
  getOpenAttempt,
  nextQuestion,
} from "@/server/services/diagnostic-service";
import {
  answerBaselineQuestionAction,
  startBaselineAction,
  submitBaselineAction,
} from "@/server/actions/diagnostic";

export const metadata: Metadata = { title: "Baseline" };

export default async function BaselinePage() {
  const actor = await requireActor();
  requireCapability(actor, "learner.dashboard.view");

  const supabase = await createSupabaseServerClient();
  const diagnostic = await getBaselineDiagnostic(supabase);
  if (!diagnostic) {
    // Nothing published: the gate cannot be satisfied, so do not trap the
    // learner on an empty page.
    redirect("/dashboard");
  }

  const attempt = await getOpenAttempt(supabase, actor.profileId);

  if (!attempt) {
    const competencyCount = await countProbedCompetencies(supabase, diagnostic.id);
    return (
      <BaselineStart
        diagnostic={diagnostic}
        competencyCount={competencyCount}
        action={startBaselineAction}
      />
    );
  }

  const question = await nextQuestion(supabase, attempt.id);

  if (!question) {
    return (
      <BaselineFinish
        attemptId={attempt.id}
        answeredCount={attempt.answered_count}
        action={submitBaselineAction}
      />
    );
  }

  return (
    <BaselineQuestion
      question={question}
      attemptId={attempt.id}
      action={answerBaselineQuestionAction}
    />
  );
}
