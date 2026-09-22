"use client";
import { useActionState } from "react";
import { curriculumReviewAction } from "@/server/actions/curriculum-review";
import { idleState } from "@/server/actions/action-result";

export interface AssessmentCriterion { id: string; criterion: string; minimum: number; anchors: string[] }
export function CurriculumReviewForm({ attemptId, claimed, rubric }: { attemptId: string; claimed: boolean; rubric: AssessmentCriterion[] }) {
  const [state, action, pending] = useActionState(curriculumReviewAction, idleState);
  return <form action={action} className="space-y-3">
    <input type="hidden" name="attemptId" value={attemptId} />
    {claimed ? <>
      {rubric.map(criterion => <label className="block" key={criterion.id}><span>{criterion.criterion}</span>
        <select name={`score:${criterion.id}`} required defaultValue="" className="my-2 block max-w-full rounded border border-white/20 bg-background p-2">
          <option value="">Choose a score (minimum {criterion.minimum})</option>
          {criterion.anchors.map((anchor, score) => <option key={score} value={score}>{score} — {anchor}</option>)}
        </select>
      </label>)}
      <label className="block">Evidence-based feedback and revision guidance<textarea name="feedback" required minLength={20} maxLength={4000} rows={4} className="mt-2 block w-full rounded border border-white/20 bg-transparent p-3" /></label>
      <button name="operation" value="evaluate" disabled={pending} className="rounded border border-white/20 px-4 py-2">Record assessment result</button>
    </> : <button name="operation" value="claim" disabled={pending} className="rounded border border-white/20 px-4 py-2">Claim assessment review</button>}
    {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
  </form>;
}
