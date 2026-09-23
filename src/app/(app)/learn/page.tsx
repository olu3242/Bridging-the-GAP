import Link from "next/link";
import { requireContext } from "@/server/services/actor";
import { requireCapability } from "@/server/services/page-guard";
import { can } from "@/domain/identity/actor";

import { listVisibleLessons, searchCurriculum, type CatalogLesson } from "@/server/services/curriculum-service";
import { groupByPathway, domainTitle } from "@/domain/curriculum/pathways";

export const metadata = { title: "Learning catalog" };

function LessonCard({ lesson }: { lesson: CatalogLesson }) {
  return (
    <li className="rounded-xl border border-line p-4">
      <p className="text-xs text-ink-subtle">
        {lesson.lesson_code} · v{lesson.version}
        {lesson.status === "published" ? null : ` · ${lesson.status}`}
      </p>
      <h3 className="mt-2 font-semibold">
        <Link href={`/learn/${lesson.activity_id}`} className="text-brand hover:underline">
          {lesson.title}
        </Link>
      </h3>
      <p className="mt-2 text-sm text-ink">{lesson.objective}</p>
    </li>
  );
}

export default async function LearningCatalog({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; domain?: string; page?: string }>;
}) {
  const [{ supabase, actor }, parameters] = await Promise.all([requireContext(), searchParams]);
  requireCapability(actor, "profile.read_own");
  const query = typeof parameters.q === "string" ? parameters.q.slice(0, 200).trim() : "";
  const domain = typeof parameters.domain === "string" && /^D\d{2}$/.test(parameters.domain) ? parameters.domain : null;
  const page = Math.min(10000, Math.max(1, Number.parseInt(parameters.page ?? "1", 10) || 1));
  const searching = Boolean(query || domain);
  const isOperator = can(actor, "operator.console.view");

  // Search keeps its own paginated RPC. The pathway overview needs the whole
  // visible set, which is at most the 112-lesson catalog.
  const [result, lessons] = await Promise.all([
    searching ? searchCurriculum(supabase, query, domain, page) : null,
    searching ? Promise.resolve([] as CatalogLesson[]) : listVisibleLessons(supabase),
  ]);

  const link = (nextPage: number) =>
    `/learn?${new URLSearchParams({ q: query, ...(domain ? { domain } : {}), page: String(nextPage) })}`;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Learning catalog</h1>
        <p className="text-sm text-ink-muted">
          {searching
            ? `${result?.catalog_total ?? 0} visible lesson contracts across ${result?.domains ?? 0} domains.`
            : `${lessons.length} lesson${lessons.length === 1 ? "" : "s"} available to you, grouped into six pathways.`}
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="flex flex-1 flex-col gap-1 text-sm text-ink">
          Search lessons
          <input
            name="q"
            defaultValue={query}
            maxLength={200}
            className="rounded-lg border border-line bg-white/5 p-2 text-ink placeholder:text-ink-subtle"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Domain code
          <input
            name="domain"
            defaultValue={domain ?? ""}
            placeholder="e.g. D11"
            pattern="D[0-9]{2}"
            className="w-28 rounded-lg border border-line bg-white/5 p-2 text-ink placeholder:text-ink-subtle"
          />
        </label>
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-surface-0">
          Search
        </button>
      </form>

      {searching && result ? (
        <section className="space-y-4">
          <p className="text-sm text-ink-muted">{result.total} matching lessons</p>
          {result.lessons.length === 0 ? (
            <p role="status" className="rounded-xl border border-line p-4 text-ink">
              No lessons match this view. Draft content is visible only to authorized content operators.{" "}
              <Link href="/learn" className="text-brand underline">
                Clear filters
              </Link>
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {result.lessons.map((lesson) => (
                <LessonCard key={lesson.activity_id} lesson={lesson as CatalogLesson} />
              ))}
            </ul>
          )}
          <nav aria-label="Catalog pages" className="flex gap-4 text-sm text-brand">
            {page > 1 ? <Link href={link(page - 1)}>Previous page</Link> : null}
            {page * 20 < result.total ? <Link href={link(page + 1)}>Next page</Link> : null}
          </nav>
        </section>
      ) : lessons.length === 0 ? (
        <p role="status" data-testid="catalog-empty" className="rounded-xl border border-line p-4 text-ink">
          The learning catalog is being prepared. Lessons appear here once each one&apos;s assessment, prerequisites and
          media have been verified and the lesson has been published.
        </p>
      ) : (
        <div className="space-y-8">
          {isOperator ? (
            <p role="status" className="rounded-xl border border-line p-4 text-sm text-ink">
              You are seeing unpublished drafts because you hold an operator role. Learners see published lessons only.
            </p>
          ) : null}
          {groupByPathway(lessons).map(({ pathway, domains }) => (
            <section key={pathway.id} aria-labelledby={`pathway-${pathway.id}`} className="space-y-4">
              <div>
                <h2 id={`pathway-${pathway.id}`} className="text-xl font-semibold">
                  {pathway.title}
                </h2>
                <p className="mt-1 text-sm text-ink">{pathway.summary}</p>
              </div>
              {domains.map((entry) => (
                <div key={entry.code} className="space-y-3">
                  <h3 className="text-sm font-medium text-ink-muted">
                    {domainTitle(entry.code)} <span className="text-ink-subtle">· {entry.code}</span>
                  </h3>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {entry.lessons.map((lesson) => (
                      <LessonCard key={lesson.activity_id} lesson={lesson} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
