"use client";
import { useActionState } from "react";
import { curriculumAttemptAction } from "@/server/actions/curriculum";
import { idleState } from "@/server/actions/action-result";

export interface LessonAttempt {
  id: string;
  attempt_number: number;
  status: "in_progress" | "submitted" | "evaluated";
  practice_output: string | null;
  selected_option: string | null;
  passed: boolean | null;
  feedback: string | null;
  remediation_acknowledged_at: string | null;
}

export function LessonAttemptForm({ activityId, attempt }: { activityId: string; attempt: LessonAttempt | null }) {
  const [state, action, pending] = useActionState(curriculumAttemptAction, idleState);
  const button = "rounded-lg border border-white/20 px-4 py-2 disabled:opacity-50";
  return <section className="space-y-3">
    <h2 className="text-xl font-semibold">Your saved work</h2>
    {attempt ? <p>Attempt {attempt.attempt_number} · {attempt.status}{attempt.status === "evaluated" ? (attempt.passed ? " · Passed" : " · Needs revision") : ""}</p> : null}
    {attempt?.feedback ? <p className="whitespace-pre-wrap">Reviewer feedback: {attempt.feedback}</p> : null}
    <form action={action} className="space-y-3">
      <input type="hidden" name="activityId" value={activityId} />
      {attempt ? <input type="hidden" name="attemptId" value={attempt.id} /> : null}
      {!attempt ? <button className={button} name="operation" value="start" disabled={pending}>Enroll and start practice</button> : null}
      {attempt?.status === "in_progress" ? <>
        <label className="block">Practice artifact and checkpoint explanation
          <textarea key={attempt.id} name="output" defaultValue={attempt.practice_output ?? ""} maxLength={4000} rows={10} className="mt-2 block w-full rounded-lg border border-white/20 bg-transparent p-3" />
        </label>
        <label className="block">First checkpoint statement
          <select name="option" defaultValue={attempt.selected_option ?? ""} className="ml-3 rounded border border-white/20 bg-background p-2">
            <option value="">Choose an answer</option><option value="true">True</option><option value="false">False</option>
          </select>
        </label>
        <div className="flex gap-3"><button className={button} name="operation" value="save" disabled={pending}>Save draft</button>
          <button className={button} name="operation" value="submit" disabled={pending}>Submit for review</button></div>
      </> : null}
      {attempt?.status === "submitted" ? <p>Your work is awaiting independent review.</p> : null}
      {attempt?.status === "evaluated" && !attempt.passed ? attempt.remediation_acknowledged_at ?
        <button className={button} name="operation" value="start" disabled={pending}>Start revised attempt</button> :
        <button className={button} name="operation" value="remediate" disabled={pending}>I reviewed the feedback and remediation</button> : null}
      {attempt?.passed ? <p>Checkpoint passed. Lesson completion still requires its video and evidence requirements.</p> : null}
      {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  </section>;
}
