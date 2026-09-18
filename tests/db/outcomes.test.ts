import { describe, expect, it } from "vitest";
import {
  asUser,
  createUser,
  expectRejection,
  makeReviewer,
  proveCompetency,
  sql,
  walkBaseline,
} from "./helpers";
import { OUTCOME_STAGES } from "@/lib/db/types";

/** The seeded partner organization that owns both open opportunities. */
const PARTNER_ORG = "btg-partner-network";

async function partnerAdmin(label: string) {
  const admin = await createUser(label);
  const [org] = await sql<{ id: string }>(
    "select id from public.organizations where slug = $1",
    [PARTNER_ORG],
  );
  await sql(
    `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
     values ($1, $2, 'employer', 'active', now())`,
    [org.id, admin.id],
  );
  return { admin, orgId: org.id };
}

async function applicantOn(slug: string, label: string) {
  const learner = await createUser(label);
  await walkBaseline(learner.id, { correctly: false });
  const [opportunity] = await sql<{ id: string }>(
    "select id from public.opportunities where slug = $1",
    [slug],
  );
  const applicationId = await asUser(learner.id, async (client) => {
    const result = await client.query(
      "select (public.apply_to_opportunity($1)).id as id",
      [opportunity.id],
    );
    return result.rows[0].id as string;
  });
  return { learner, opportunityId: opportunity.id, applicationId };
}

function advance(userId: string, applicationId: string, status: string, note?: string) {
  return asUser(userId, (client) =>
    client.query("select public.advance_application($1, $2::public.btg_application_status, $3)", [
      applicationId,
      status,
      note ?? null,
    ]),
  );
}

function respond(userId: string, applicationId: string, accept: boolean) {
  return asUser(userId, (client) =>
    client.query("select public.respond_to_offer($1, $2)", [applicationId, accept]),
  );
}

async function statusOf(applicationId: string): Promise<string> {
  const [row] = await sql<{ status: string }>(
    "select status from public.applications where id = $1",
    [applicationId],
  );
  return row.status;
}

describe("an organization moves its own pipeline and nobody else's", () => {
  it("walks an application from submitted to offered", async () => {
    const { admin } = await partnerAdmin("pipeline-admin");
    const { applicationId } = await applicantOn("ai-literacy-research-assistant", "pipeline-a");

    await advance(admin.id, applicationId, "under_review");
    expect(await statusOf(applicationId)).toBe("under_review");
    await advance(admin.id, applicationId, "shortlisted");
    await advance(admin.id, applicationId, "offered");
    expect(await statusOf(applicationId)).toBe("offered");

    const [row] = await sql<{ decided_at: string | null }>(
      "select decided_at from public.applications where id = $1",
      [applicationId],
    );
    expect(row.decided_at).not.toBeNull();
  });

  it("refuses a move the registry does not allow", async () => {
    const { admin } = await partnerAdmin("pipeline-skip");
    const { applicationId } = await applicantOn("applied-ai-internship-lagos", "pipeline-b");
    // submitted -> offered skips under_review and shortlisted.
    const rejection = await expectRejection(advance(admin.id, applicationId, "offered"));
    expect(rejection.message).toMatch(/submitted.*offered|not a permitted/i);
    expect(await statusOf(applicationId)).toBe("submitted");
  });

  it("never lets an organization accept on the applicant's behalf", async () => {
    const { admin } = await partnerAdmin("pipeline-accept");
    const { applicationId } = await applicantOn("ai-literacy-research-assistant", "pipeline-c");
    const rejection = await expectRejection(advance(admin.id, applicationId, "accepted"));
    expect(rejection.code).toBe("42501");
  });

  it("hides an application from someone who does not govern the opening", async () => {
    const outsider = await createUser("pipeline-outsider");
    const { applicationId } = await applicantOn("applied-ai-internship-lagos", "pipeline-d");
    const rejection = await expectRejection(advance(outsider.id, applicationId, "under_review"));
    expect(rejection.code).toBe("P0002");
  });

  it("will not let the applicant drive their own pipeline", async () => {
    const { learner, applicationId } = await applicantOn(
      "ai-literacy-research-assistant",
      "pipeline-self",
    );
    const rejection = await expectRejection(advance(learner.id, applicationId, "shortlisted"));
    expect(rejection.code).toBe("P0002");
  });

  it("requires a readable reason before rejecting someone", async () => {
    const { admin } = await partnerAdmin("pipeline-reason");
    const { applicationId } = await applicantOn("applied-ai-internship-lagos", "pipeline-e");
    await advance(admin.id, applicationId, "under_review");
    const rejection = await expectRejection(advance(admin.id, applicationId, "rejected", "no"));
    expect(rejection.code).toBe("23514");
    await advance(admin.id, applicationId, "rejected", "The rubric evidence did not cover SQL.");
    expect(await statusOf(applicationId)).toBe("rejected");
  });

  it("tells the applicant every time their application moves", async () => {
    const { admin } = await partnerAdmin("pipeline-notify");
    const { learner, applicationId } = await applicantOn(
      "ai-literacy-research-assistant",
      "pipeline-f",
    );
    await advance(admin.id, applicationId, "under_review");
    const rows = await sql<{ category: string }>(
      "select category from public.notifications where profile_id = $1 and category like 'opportunity.%'",
      [learner.id],
    );
    expect(rows.map((r) => r.category)).toContain("opportunity.under_review");
  });
});

describe("only the applicant answers an offer", () => {
  async function offered(label: string, slug = "ai-literacy-research-assistant") {
    const { admin } = await partnerAdmin(`${label}-admin`);
    const applicant = await applicantOn(slug, label);
    await advance(admin.id, applicant.applicationId, "under_review");
    await advance(admin.id, applicant.applicationId, "shortlisted");
    await advance(admin.id, applicant.applicationId, "offered");
    return { ...applicant, admin };
  }

  it("records an acceptance", async () => {
    const { learner, applicationId } = await offered("offer-accept");
    await respond(learner.id, applicationId, true);
    expect(await statusOf(applicationId)).toBe("accepted");
  });

  it("records a decline as a withdrawal", async () => {
    const { learner, applicationId } = await offered("offer-decline");
    await respond(learner.id, applicationId, false);
    const [row] = await sql<{ status: string; withdrawn_at: string | null }>(
      "select status, withdrawn_at from public.applications where id = $1",
      [applicationId],
    );
    expect(row.status).toBe("withdrawn");
    expect(row.withdrawn_at).not.toBeNull();
  });

  it("refuses an answer from anyone but the applicant", async () => {
    const { applicationId, admin } = await offered("offer-foreign");
    const rejection = await expectRejection(respond(admin.id, applicationId, true));
    expect(rejection.code).toBe("P0002");
  });

  it("refuses an answer when there is no offer", async () => {
    const { learner, applicationId } = await applicantOn(
      "applied-ai-internship-lagos",
      "offer-none",
    );
    const rejection = await expectRejection(respond(learner.id, applicationId, true));
    expect(rejection.code).toBe("23514");
  });

  it("tells the organization the answer", async () => {
    const { learner, applicationId, admin } = await offered("offer-echo");
    await respond(learner.id, applicationId, true);
    const rows = await sql<{ category: string }>(
      "select category from public.notifications where profile_id = $1",
      [admin.id],
    );
    expect(rows.map((r) => r.category)).toContain("opportunity.offer_accepted");
  });
});

describe("the ledger records every outcome the funnel reports", () => {
  it("records project completion as its own event", async () => {
    const learner = await createUser("outcome-project");
    await walkBaseline(learner.id, { correctly: false });
    const reviewer = await makeReviewer("outcome-reviewer");
    const { projectId } = await proveCompetency(learner.id, reviewer.id, "brief-prompt-design");

    const rows = await sql<{ action: string; after: Record<string, unknown> }>(
      "select action, after from public.audit_events where object_id = $1 and action = 'project.project.completed'",
      [projectId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].after.status).toBe("completed");
  });

  it("maps each recorded action to a stage a UI can order", async () => {
    const learner = await createUser("outcome-timeline");
    await walkBaseline(learner.id, { correctly: false });

    const rows = await asUser(learner.id, async (client) => {
      const result = await client.query(
        "select outcome, stage from public.outcome_timeline_view where profile_id = $1 order by stage",
        [learner.id],
      );
      return result.rows as Array<{ outcome: string; stage: number }>;
    });
    expect(rows.length).toBeGreaterThan(0);
    // Every surfaced row carries both a name and an order; neither is null.
    expect(rows.every((r) => r.outcome !== null && r.stage !== null)).toBe(true);
    expect(rows.map((r) => r.outcome)).toContain("baseline_measured");
  });

  it("publishes exactly the stages the application declares", async () => {
    // Parity with OUTCOME_STAGES: if the view learns a new outcome name and the
    // TypeScript union does not, a UI would render a blank label.
    const [row] = await sql<{ def: string }>(
      "select pg_get_viewdef('public.outcome_timeline_view'::regclass) as def",
    );
    const published = new Set(
      [...row.def.matchAll(/THEN '([a-z_]+)'::text/g)].map((m) => m[1]),
    );
    for (const stage of published) expect(OUTCOME_STAGES).toContain(stage);
    // Every declared stage except the ones no command emits yet is published.
    for (const stage of OUTCOME_STAGES) expect(published.has(stage)).toBe(true);
  });

  it("keeps one learner's timeline out of another's", async () => {
    const [a, b] = await Promise.all([createUser("timeline-a"), createUser("timeline-b")]);
    await walkBaseline(a.id, { correctly: false });
    const seen = await asUser(b.id, async (client) => {
      const result = await client.query(
        "select count(*)::int as n from public.outcome_timeline_view where profile_id = $1",
        [a.id],
      );
      return result.rows[0].n as number;
    });
    expect(seen).toBe(0);
  });
});

describe("the learner funnel counts only what actually happened", () => {
  it("counts a proven learner from their own records", async () => {
    const learner = await createUser("funnel-proven");
    await walkBaseline(learner.id, { correctly: false });
    const reviewer = await makeReviewer("funnel-reviewer");
    await proveCompetency(learner.id, reviewer.id, "brief-prompt-design");

    const [row] = await asUser(learner.id, async (client) => {
      const result = await client.query(
        "select * from public.learner_outcome_view where profile_id = $1",
        [learner.id],
      );
      return result.rows as Array<Record<string, number>>;
    });
    expect(Number(row.competencies_measured)).toBeGreaterThan(0);
    expect(Number(row.projects_completed)).toBe(1);
    expect(Number(row.evidence_submitted)).toBe(1);
    expect(Number(row.skills_verified)).toBe(1);
    expect(Number(row.competencies_from_evidence)).toBe(1);
  });

  it("never reports another learner's totals", async () => {
    const [a, b] = await Promise.all([createUser("funnel-a"), createUser("funnel-b")]);
    await walkBaseline(a.id, { correctly: false });
    const reviewer = await makeReviewer("funnel-leak-reviewer");
    await proveCompetency(a.id, reviewer.id, "brief-prompt-design");

    const rows = await asUser(b.id, async (client) => {
      const result = await client.query(
        "select competencies_measured, skills_verified, evidence_submitted from public.learner_outcome_view where profile_id = $1",
        [a.id],
      );
      return result.rows as Array<Record<string, string>>;
    });
    // Either the row is invisible or every count reads zero. Never a real total.
    for (const row of rows) {
      expect(Number(row.competencies_measured)).toBe(0);
      expect(Number(row.skills_verified)).toBe(0);
      expect(Number(row.evidence_submitted)).toBe(0);
    }
  });

  it("gives authenticated no write path to either read model", async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated'
         and table_name in ('learner_outcome_view','outcome_timeline_view')
         and privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("cohort outcomes are aggregate-only and authorized", () => {
  async function cohortOf(size: number, label: string) {
    const { admin, orgId } = await partnerAdmin(`${label}-admin`);
    const [cohort] = await sql<{ id: string }>(
      `insert into public.cohorts (organization_id, slug, name)
       values ($1, $2, $3) returning id`,
      [orgId, `${label}-${Date.now()}`, `${label} cohort`],
    );
    for (let i = 0; i < size; i += 1) {
      const member = await createUser(`${label}-m${i}`);
      await sql("insert into public.cohort_members (cohort_id, profile_id) values ($1, $2)", [
        cohort.id,
        member.id,
      ]);
      if (i === 0) await walkBaseline(member.id, { correctly: false });
    }
    return { admin, cohortId: cohort.id };
  }

  it("reports aggregates to an organization admin", async () => {
    const { admin, cohortId } = await cohortOf(5, "cohort-ok");
    const [row] = await asUser(admin.id, async (client) => {
      const result = await client.query("select * from public.cohort_outcomes($1)", [cohortId]);
      return result.rows as Array<Record<string, string>>;
    });
    expect(Number(row.learners)).toBe(5);
    expect(Number(row.with_baseline)).toBe(1);
    expect(Number(row.with_verified_skill)).toBe(0);
  });

  it("refuses a cohort small enough to identify an individual", async () => {
    const { admin, cohortId } = await cohortOf(3, "cohort-small");
    const rejection = await expectRejection(
      asUser(admin.id, (client) =>
        client.query("select * from public.cohort_outcomes($1)", [cohortId]),
      ),
    );
    expect(rejection.code).toBe("23514");
  });

  it("refuses a cohort the caller does not govern", async () => {
    const { cohortId } = await cohortOf(5, "cohort-foreign");
    const outsider = await createUser("cohort-outsider");
    const rejection = await expectRejection(
      asUser(outsider.id, (client) =>
        client.query("select * from public.cohort_outcomes($1)", [cohortId]),
      ),
    );
    expect(rejection.code).toBe("P0002");
  });

  it("returns no per-learner column at all", async () => {
    const rows = await sql<{ argnames: string[] }>(
      `select proargnames as argnames from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'cohort_outcomes'`,
    );
    expect(rows[0].argnames.some((name) => name.includes("profile"))).toBe(false);
  });
});
