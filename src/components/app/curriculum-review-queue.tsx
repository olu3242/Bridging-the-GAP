import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgresError } from "@/domain/shared/errors";
import { CurriculumReviewForm, type AssessmentCriterion } from "./curriculum-review-form";

export async function CurriculumReviewQueue({ supabase, profileId }: { supabase: SupabaseClient; profileId: string }) {
  const result = await supabase.from("curriculum_attempts").select("id,activity_id,profile_id,attempt_number,practice_output,selected_option,claimed_by")
    .eq("status", "submitted").neq("profile_id", profileId).order("submitted_at").limit(50);
  if (result.error) throw fromPostgresError(result.error, "We could not load assessment submissions.");
  const submissions = await Promise.all((result.data ?? []).map(async attempt => {
    const claimed = attempt.claimed_by === profileId;
    const rubric = claimed ? await supabase.rpc("curriculum_review_rubric", { p_attempt_id: attempt.id }) : { data: [], error: null };
    if (rubric.error) throw fromPostgresError(rubric.error, "We could not load the assessment rubric.");
    return { ...attempt, claimed, rubric: rubric.data as AssessmentCriterion[] };
  }));
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Lesson assessment submissions</h2>
    <p className="text-sm text-ink-muted">Practice and checkpoint evaluation. Verified skills require the separate project evidence review below.</p>
    {!submissions.length ? <p>No lesson assessments awaiting review.</p> : null}
    {submissions.map(attempt => <article key={attempt.id} className="space-y-3 rounded-xl border border-white/10 p-4">
      <h3 className="font-semibold">Assessment attempt {attempt.attempt_number}</h3>
      <p className="whitespace-pre-wrap">{attempt.practice_output}</p><p>Checkpoint response: {attempt.selected_option}</p>
      {attempt.claimed_by && !attempt.claimed ? <p>Claimed by another reviewer.</p> :
        <CurriculumReviewForm attemptId={attempt.id} claimed={attempt.claimed} rubric={attempt.rubric} />}
    </article>)}
  </section>;
}
