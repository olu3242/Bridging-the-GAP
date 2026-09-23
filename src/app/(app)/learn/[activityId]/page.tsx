import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";

import { getCurriculumLesson, getLessonVideo } from "@/server/services/curriculum-service";
import { LessonVideo } from "@/components/app/lesson-video";
import { LessonAttemptForm, type LessonAttempt } from "@/components/app/lesson-attempt";
import { fromPostgresError } from "@/domain/shared/errors";
import { LessonViewed } from "@/components/app/tracked-video";
import { AssignProjectButton } from "@/components/app/assign-project-button";
import { assignProjectAction } from "@/server/actions/projects";
import { LessonVisual, type LessonVisualRow } from "@/components/app/lesson-visual";

export const metadata = { title: "Lesson" };

export default async function CurriculumLessonPage({ params }: { params: Promise<{ activityId: string }> }) {
  const [{ activityId }, { supabase, actor }] = await Promise.all([params, requireContext()]);
  requireCapability(actor, "profile.read_own");
  if (!z.guid().safeParse(activityId).success) notFound();
  const lesson = await getCurriculumLesson(supabase, activityId);
  if (!lesson) notFound();
  const media = await getLessonVideo(supabase, activityId);
  const content = lesson.contract;
  const visualResult = await supabase.from("curriculum_visual_assets").select("id,visual_type,status,metadata,storage_object_path").eq("activity_id", activityId).eq("status", "published");
  if (visualResult.error) throw fromPostgresError(visualResult.error, "We could not load lesson visuals.");
  const visuals = (visualResult.data ?? []) as LessonVisualRow[];
  const visual = (slot: string, equivalent: string) => <LessonVisual slot={slot} equivalent={equivalent} asset={visuals.find(asset => asset.visual_type === slot)} />;
  const progress = await supabase.rpc("curriculum_progress", { p_activity_id: activityId });
  if (progress.error) throw fromPostgresError(progress.error, "We could not load your lesson progress.");
  const attempts = await supabase.from("curriculum_attempts").select("*").eq("activity_id", activityId)
    .eq("profile_id", actor.profileId).order("attempt_number", { ascending: false }).limit(1).maybeSingle();
  if (attempts.error) throw fromPostgresError(attempts.error, "We could not load your saved work.");
  const projectMappings = await supabase.from("curriculum_project_briefs").select("brief_id,project_briefs(slug,title)").eq("activity_id", activityId);
  if (projectMappings.error) throw fromPostgresError(projectMappings.error, "We could not load the project requirements.");
  const briefIds = (projectMappings.data ?? []).map(mapping => mapping.brief_id);
  const projects = briefIds.length ? await supabase.from("projects").select("id,brief_id,status").eq("profile_id", actor.profileId).in("brief_id", briefIds).order("assigned_at", { ascending: false }) : { data: [], error: null };
  if (projects.error) throw fromPostgresError(projects.error, "We could not load your projects.");
  return <article className="space-y-6">
    <Link href="/learn" className="text-sm text-brand underline">Learning catalog</Link>
    <header>
      <p className="text-sm text-ink-subtle">{lesson.domain_code} · {lesson.lesson_code} · Version {lesson.version} · {lesson.status}</p>
      <h1 className="mt-2 text-3xl font-semibold">{content.title}</h1>
      <p className="mt-2 text-ink">{content.description}</p>
      <p className="mt-2 text-sm text-ink-subtle">{content.estimated_minutes} minutes · {content.difficulty}</p>
    </header>
    {visual("cover", content.learning_objective.text)}
    {lesson.status === "draft" ? <p role="status" className="rounded-xl border border-white/10 p-4">Content preview. This version is unpublished and cannot award progress, assessment results or credentials.</p> : null}
    <section><h2 className="text-xl font-semibold">Learning objective</h2><p className="mt-2 text-ink">{content.learning_objective.text}</p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink">{content.measurable_outcomes.map(outcome => <li key={outcome.id}>{outcome.text}</li>)}</ul>
    </section>
    {lesson.status === "published" ? <LessonViewed activityId={activityId} /> : null}
    <LessonVideo {...media} activityId={lesson.status === "published" ? activityId : undefined} resumePosition={progress.data?.last_position} />
    {lesson.status === "published" && progress.data ? <p className="text-sm text-ink-muted" data-testid="playback-summary">
      Recorded playback: {Math.floor(progress.data.watched_seconds)} seconds · Video threshold {progress.data.threshold_reached ? "reached" : "not reached"} · Lesson {progress.data.completed ? "completed" : "incomplete"}.
    </p> : null}
    {content.instructional_content.map(section => <section key={section.section_id} id={section.section_id}>
      <h2 className="text-xl font-semibold">{section.heading}</h2><p className="mt-3 whitespace-pre-wrap leading-relaxed text-ink">{section.text}</p>
      {visual(section.section_id.endsWith(".instruction") ? "concept" : section.section_id.endsWith(".worked-example") ? "worked_example" : "misconception", section.text)}
    </section>)}
    <section><h2 className="text-xl font-semibold">Practice</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-ink">{content.practice.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol>
      {visual("practice_evidence", content.practice.instructions.join("\n"))}
      <details className="mt-3"><summary>Starter material</summary><pre className="mt-2 overflow-auto rounded-lg bg-white/5 p-3 text-xs">{JSON.stringify(content.practice.starter_material, null, 2)}</pre></details>
      <details className="mt-3"><summary>Hints</summary><ul className="mt-2 list-disc pl-5">{content.practice.hints.map(hint => <li key={hint}>{hint}</li>)}</ul></details>
    </section>
    <section><h2 className="text-xl font-semibold">Checkpoint</h2><ol className="mt-3 list-decimal space-y-3 pl-5 text-ink">{content.checkpoint.questions.map(question => <li key={question.question_id} className="whitespace-pre-wrap">{question.prompt}</li>)}</ol></section>
    <section><h2 className="text-xl font-semibold">Review and next action</h2><p className="mt-2 text-ink">{content.progression.remediation_rule.next_action}</p>
      <p className="mt-2 text-sm text-ink-subtle">Prerequisites: {content.prerequisites.join(", ") || "None"}. Competencies: {content.competency_ids.join(", ")}.</p>
    </section>
    {lesson.status === "published" ? <LessonAttemptForm activityId={activityId} attempt={attempts.data as LessonAttempt | null} /> : null}
    {briefIds.length ? <section className="space-y-3"><h2 className="text-xl font-semibold">Project evidence checks</h2>
      <p>Submit the relevant capstone artifacts for each competency. Each check requires independent review before it can contribute verified evidence to your portfolio.</p>
      {(projectMappings.data ?? []).map(mapping => {
        const brief = mapping.project_briefs as unknown as { slug: string; title: string } | null;
        const project = projects.data?.find(item => item.brief_id === mapping.brief_id);
        return <div key={mapping.brief_id} className="rounded-lg border border-white/10 p-4"><h3>{brief?.title}</h3>
          {project ? <Link className="text-brand underline" href={`/projects/${project.id}`}>Open evidence and review · {project.status}</Link> :
            lesson.status === "published" && brief ? <AssignProjectButton briefSlug={brief.slug} stepId="" action={assignProjectAction} /> : <p>Available after publication and lesson enrollment.</p>}
        </div>;
      })}
    </section> : null}
  </article>;
}
