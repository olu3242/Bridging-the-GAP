import Link from "next/link";
import { requireContext } from "@/server/services/actor";
import { assertCan } from "@/domain/identity/actor";
import { searchCurriculum } from "@/server/services/curriculum-service";

export const metadata = { title: "Learning catalog" };

export default async function LearningCatalog({ searchParams }: { searchParams: Promise<{ q?: string; domain?: string; page?: string }> }) {
  const [{ supabase, actor }, parameters] = await Promise.all([requireContext(), searchParams]);
  assertCan(actor, "profile.read_own");
  const query = typeof parameters.q === "string" ? parameters.q.slice(0, 200).trim() : "";
  const domain = typeof parameters.domain === "string" && /^D\d{2}$/.test(parameters.domain) ? parameters.domain : null;
  const page = Math.min(10000, Math.max(1, Number.parseInt(parameters.page ?? "1", 10) || 1));
  const result = await searchCurriculum(supabase, query, domain, page);
  const link = (nextPage: number) => `/learn?${new URLSearchParams({ q: query, ...(domain ? { domain } : {}), page: String(nextPage) })}`;
  return <div className="space-y-5">
    <h1 className="text-3xl font-semibold">Learning catalog</h1>
    <p className="text-sm text-ink-muted">{result.catalog_total} visible lesson contracts across {result.domains} domains · {result.published} published.</p>
    <form className="flex flex-wrap items-end gap-3" role="search">
      <label className="flex flex-1 flex-col gap-1 text-sm">Search lessons<input name="q" defaultValue={query} maxLength={200} className="rounded-lg border border-white/20 bg-white/5 p-2" /></label>
      <label className="flex flex-col gap-1 text-sm">Domain code<input name="domain" defaultValue={domain ?? ""} placeholder="e.g. D11" pattern="D[0-9]{2}" className="w-28 rounded-lg border border-white/20 bg-white/5 p-2" /></label>
      <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm text-black">Search</button>
    </form>
    <p className="text-sm text-ink-muted">{result.total} matching lessons</p>
    {result.lessons.length === 0 ? <p role="status">No lessons match this view. Draft content is visible only to authorized content operators. <Link href="/learn" className="text-brand underline">Clear filters</Link></p> :
      <ul className="grid gap-3 sm:grid-cols-2">{result.lessons.map(lesson => <li key={lesson.activity_id} className="rounded-xl border border-white/10 p-4">
        <p className="text-xs text-ink-subtle">{lesson.domain_code} · {lesson.lesson_code} · v{lesson.version} · {lesson.status}</p>
        <h2 className="mt-2 font-semibold"><Link href={`/learn/${lesson.activity_id}`} className="text-brand hover:underline">{lesson.title}</Link></h2>
        <p className="mt-2 text-sm text-ink-muted">{lesson.objective}</p>
      </li>)}</ul>}
    <nav aria-label="Catalog pages" className="flex gap-4 text-sm text-brand">
      {page > 1 ? <Link href={link(page - 1)}>Previous page</Link> : null}
      {page * 20 < result.total ? <Link href={link(page + 1)}>Next page</Link> : null}
    </nav>
  </div>;
}
