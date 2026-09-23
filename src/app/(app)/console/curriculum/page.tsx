import Link from "next/link";
import { requireContext } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";
import { getReleaseReadiness } from "@/server/services/curriculum-release-service";
import { domainTitle } from "@/domain/curriculum/pathways";
import { PublishReadyLessons } from "@/components/app/publish-ready-lessons";

export const metadata = { title: "Curriculum release" };
export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd
        className={`mt-1 text-3xl font-semibold tabular-nums ${
          tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Operator-only view of what stands between the catalog and publication.
 *
 * Every number here is derived from `curriculum_release_readiness`, which is
 * itself operator-gated in SQL — this page's capability check is the second
 * lock, not the only one. No learner route links here and no service-role key
 * is involved; the operator's own session does the work.
 */
export default async function CurriculumReleaseConsole() {
  const { supabase, actor } = await requireContext();
  requireCapability(actor, "operator.console.view");
  const summary = await getReleaseReadiness(supabase);
  const blocked = summary.lessons.filter((lesson) => lesson.status === "draft" && lesson.blockers.length > 0);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Curriculum release</h1>
        <p className="text-sm text-ink">
          Publication runs through <code className="text-ink-muted">publish_curriculum_lesson</code> for every lesson. This
          console reports what that function would decide and runs it in dependency order; it cannot relax a gate.
        </p>
      </header>

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Total lessons" value={summary.total} />
        <Stat label="Published" value={summary.published} tone={summary.published > 0 ? "good" : undefined} />
        <Stat label="Draft" value={summary.draft} />
        <Stat label="Ready to publish" value={summary.ready} tone={summary.ready > 0 ? "good" : undefined} />
        <Stat label="Media blocked" value={summary.mediaBlocked} tone={summary.mediaBlocked ? "warn" : undefined} />
        <Stat label="Prerequisite blocked" value={summary.prerequisiteBlocked} tone={summary.prerequisiteBlocked ? "warn" : undefined} />
        <Stat label="Assessment blocked" value={summary.assessmentBlocked} tone={summary.assessmentBlocked ? "warn" : undefined} />
        <Stat label="Verified videos" value={summary.media.verified} tone={summary.media.verified ? "good" : "warn"} />
      </dl>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Media coverage</h2>
        <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Verified" value={summary.media.verified} />
          <Stat label="Pending verification" value={summary.media.verification_pending} />
          <Stat label="Mapped only" value={summary.media.mapped} />
          <Stat label="Unmapped" value={summary.media.unmapped} />
          <Stat label="Unavailable" value={summary.media.unavailable} />
          <Stat label="No video needed" value={summary.media.not_required} />
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Actions</h2>
        <PublishReadyLessons readyCount={summary.ready} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Per-domain status</h2>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th scope="col" className="p-3">Domain</th>
                <th scope="col" className="p-3">Total</th>
                <th scope="col" className="p-3">Published</th>
                <th scope="col" className="p-3">Ready</th>
                <th scope="col" className="p-3">Blocked</th>
              </tr>
            </thead>
            <tbody>
              {summary.byDomain.map((domain) => (
                <tr key={domain.domain_code} className="border-t border-line">
                  <th scope="row" className="p-3 text-left font-normal text-ink">
                    {domainTitle(domain.domain_code)} <span className="text-ink-subtle">· {domain.domain_code}</span>
                  </th>
                  <td className="p-3 tabular-nums text-ink">{domain.total}</td>
                  <td className="p-3 tabular-nums text-ink">{domain.published}</td>
                  <td className="p-3 tabular-nums text-ink">{domain.ready}</td>
                  <td className="p-3 tabular-nums text-ink">{domain.blocked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Blocked lessons ({blocked.length})</h2>
        {blocked.length === 0 ? (
          <p className="rounded-xl border border-line p-4 text-ink">No lesson is held by an unmet gate.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-muted">
                <tr>
                  <th scope="col" className="p-3">Lesson</th>
                  <th scope="col" className="p-3">Media</th>
                  <th scope="col" className="p-3">Blocking reason</th>
                  <th scope="col" className="p-3">Preview</th>
                </tr>
              </thead>
              <tbody>
                {blocked.map((lesson) => (
                  <tr key={lesson.activity_id} className="border-t border-line align-top">
                    <th scope="row" className="p-3 text-left font-normal">
                      <span className="text-ink">{lesson.lesson_code}</span>
                      <span className="block text-xs text-ink-subtle">{lesson.domain_code} · v{lesson.version}</span>
                    </th>
                    <td className="p-3 text-ink-muted">{lesson.media.state}</td>
                    <td className="p-3 text-ink">
                      <ul className="space-y-1">
                        {lesson.blockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="p-3">
                      <Link href={`/learn/${lesson.activity_id}`} className="text-brand underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
