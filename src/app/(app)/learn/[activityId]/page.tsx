import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { getCurriculumLesson, getLessonVideo } from "@/server/services/curriculum-service";
import { LessonVideo } from "@/components/app/lesson-video";
import { LessonAttemptForm, type LessonAttempt } from "@/components/app/lesson-attempt";
import { fromPostgresError } from "@/domain/shared/errors";

export const metadata = { title: "Lesson" };

export default async function CurriculumLessonPage({ params }: { params: Promise<{ activityId: string }> }) {
  const [{ activityId }, { supabase, actor }] = await Promise.all([params, requireContext()]);
  assertCan(actor, "profile.read_own");
  if (!z.uuid().safeParse(activityId).success) notFound();
  const lesson = await getCurriculumLesson(supabase, activityId);
  if (!lesson) notFound();
  const media = await getLessonVideo(supabase, activityId);
  const content = lesson.contract;
  const attempts = await supabase.from("curriculum_attempts").select("*").eq("activity_id", activityId)
    .eq("profile_id", actor.profileId).order("attempt_number", { ascending: false }).limit(1).maybeSingle();
  if (attempts.error) throw fromPostgresError(attempts.error, "We could not load your saved work.");
  return <article className="space-y-6">
    <Link href="/learn" className="text-sm text-brand underline">Learning catalog</Link>
    <header>
      <p className="text-sm text-ink-subtle">{lesson.domain_code} · {lesson.lesson_code} · Version {lesson.version} · {lesson.status}</p>
      <h1 className="mt-2 text-3xl font-semibold">{content.title}</h1>
      <p className="mt-2 text-ink-muted">{content.description}</p>
      <p className="mt-2 text-sm text-ink-subtle">{content.estimated_minutes} minutes · {content.difficulty}</p>
    </header>
    {lesson.status === "draft" ? <p role="status" className="rounded-xl border border-white/10 p-4">Content preview. This version is unpublished and cannot award progress, assessment results or credentials.</p> : null}
    <section><h2 className="text-xl font-semibold">Learning objective</h2><p className="mt-2">{content.learning_objective.text}</p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-muted">{content.measurable_outcomes.map(outcome => <li key={outcome.id}>{outcome.text}</li>)}</ul>
    </section>
    <LessonVideo {...media} />
    {content.instructional_content.map(section => <section key={section.section_id} id={section.section_id}>
      <h2 className="text-xl font-semibold">{section.heading}</h2><p className="mt-3 whitespace-pre-wrap leading-relaxed text-ink-muted">{section.text}</p>
    </section>)}
    <section><h2 className="text-xl font-semibold">Practice</h2><ol className="mt-3 list-decimal space-y-2 pl-5">{content.practice.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol>
      <details className="mt-3"><summary>Starter material</summary><pre className="mt-2 overflow-auto rounded-lg bg-white/5 p-3 text-xs">{JSON.stringify(content.practice.starter_material, null, 2)}</pre></details>
      <details className="mt-3"><summary>Hints</summary><ul className="mt-2 list-disc pl-5">{content.practice.hints.map(hint => <li key={hint}>{hint}</li>)}</ul></details>
    </section>
    <section><h2 className="text-xl font-semibold">Checkpoint</h2><ol className="mt-3 list-decimal space-y-3 pl-5">{content.checkpoint.questions.map(question => <li key={question.question_id} className="whitespace-pre-wrap">{question.prompt}</li>)}</ol></section>
    <section><h2 className="text-xl font-semibold">Review and next action</h2><p className="mt-2 text-ink-muted">{content.progression.remediation_rule.next_action}</p>
      <p className="mt-2 text-sm text-ink-subtle">Prerequisites: {content.prerequisites.join(", ") || "None"}. Competencies: {content.competency_ids.join(", ")}.</p>
    </section>
    {lesson.status === "published" ? <LessonAttemptForm activityId={activityId} attempt={attempts.data as LessonAttempt | null} /> : null}
  </article>;
}
