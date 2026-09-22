import { describe, expect, it } from "vitest";
import {
  asUser,
  createUser,
  expectRejection,
  generatePathwayOnce,
  makeReviewer,
  proveCompetency,
  sql,
  walkBaseline,
} from "./helpers";

async function measuredLearner(label: string) {
  const l = await createUser(label);
  await walkBaseline(l.id, { correctly: false });
  return l;
}

async function refreshMatches(userId: string): Promise<number> {
  return asUser(userId, async (client) => {
    const result = await client.query("select public.refresh_my_matches() as n");
    return Number(result.rows[0].n);
  });
}

async function matchesFor(userId: string) {
  return asUser(userId, async (client) => {
    const result = await client.query(
      `select o.slug, m.score, m.matched, m.missing
       from public.opportunity_matches m
       join public.opportunities o on o.id = m.opportunity_id
       where m.profile_id = $1 order by m.score desc`,
      [userId],
    );
    return result.rows as Array<{
      slug: string;
      score: number;
      matched: Array<Record<string, unknown>>;
      missing: Array<Record<string, unknown>>;
    }>;
  });
}

describe("matching is explainable and evidence-bound", () => {
  it("scores an unproven learner low and says exactly what is missing", async () => {
    const l = await measuredLearner("unproven");
    expect(await refreshMatches(l.id)).toBe(2);

    const matches = await matchesFor(l.id);
    const internship = matches.find((m) => m.slug === "applied-ai-internship-lagos")!;
    expect(internship.score).toBe(0);
    expect(internship.matched).toEqual([]);
    expect(internship.missing).toHaveLength(4);
    // Each gap names the reason, not just a flag.
    const reasons = internship.missing.map((m) => m.reason);
    expect(reasons.every((r) => typeof r === "string" && String(r).length > 0)).toBe(true);
    expect(reasons).toContain("measured but not verified from evidence");
  });

  it("does not count a self-declared or diagnostic level as qualifying", async () => {
    const l = await measuredLearner("diagnostic-only");
    // Give the learner a strong baseline without any verified evidence.
    await sql(
      `update public.learner_competencies set level = 5 where profile_id = $1`,
      [l.id],
    );
    await refreshMatches(l.id);

    const internship = (await matchesFor(l.id)).find(
      (m) => m.slug === "applied-ai-internship-lagos",
    )!;
    expect(internship.score).toBe(0);
    expect(internship.missing.map((m) => m.reason)).toContain(
      "measured but not verified from evidence",
    );
  });

  it("raises the score only as verified skills land, and shows the chain", async () => {
    const [l, r] = await Promise.all([measuredLearner("climbing"), makeReviewer("rev-climb")]);
    await proveCompetency(l.id, r.id, "brief-data-interpretation");
    await refreshMatches(l.id);

    const research = (await matchesFor(l.id)).find(
      (m) => m.slug === "ai-literacy-research-assistant",
    )!;
    // One of two required met => 40 of the 80 required weight.
    expect(research.score).toBe(40);
    expect(research.matched).toHaveLength(1);
    expect(research.matched[0]).toMatchObject({ competency: "data-interpretation", verified_level: 3 });
    expect(research.matched[0].evidence_id).toBeTruthy();

    await proveCompetency(l.id, r.id, "brief-ai-limitations");
    await refreshMatches(l.id);
    const after = (await matchesFor(l.id)).find((m) => m.slug === "ai-literacy-research-assistant")!;
    expect(after.score).toBe(80); // both required met, desirable still open
    expect(after.missing.map((m) => m.competency)).toEqual(["data-quality"]);
  });

  it("recomputes automatically when a skill is verified", async () => {
    const [l, r] = await Promise.all([measuredLearner("auto"), makeReviewer("rev-auto")]);
    // No explicit refresh call anywhere in this test.
    await proveCompetency(l.id, r.id, "brief-data-interpretation");
    const matches = await matchesFor(l.id);
    expect(matches.length).toBe(2);
    expect(matches.find((m) => m.slug === "ai-literacy-research-assistant")!.score).toBe(40);
  });

  it("notifies once when every requirement is finally met", async () => {
    const [l, r] = await Promise.all([measuredLearner("qualified"), makeReviewer("rev-qual")]);
    await proveCompetency(l.id, r.id, "brief-data-interpretation");
    await proveCompetency(l.id, r.id, "brief-ai-limitations");
    await refreshMatches(l.id);
    await refreshMatches(l.id); // idempotency

    const notifications = await sql<{ dedupe_key: string }>(
      "select dedupe_key from public.notifications where profile_id = $1 and category = 'opportunity.matched'",
      [l.id],
    );
    expect(notifications).toHaveLength(1);
  });

  it("keeps one learner's matches private from another", async () => {
    const [a, b] = await Promise.all([measuredLearner("match-a"), createUser("match-b")]);
    await refreshMatches(a.id);
    const seen = await asUser(b.id, async (client) => {
      const result = await client.query(
        "select id from public.opportunity_matches where profile_id = $1",
        [a.id],
      );
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });
});

describe("applying", () => {
  it("snapshots the match so a later recompute cannot rewrite it", async () => {
    const [l, r] = await Promise.all([measuredLearner("applicant"), makeReviewer("rev-apply")]);
    await proveCompetency(l.id, r.id, "brief-data-interpretation");
    await refreshMatches(l.id);

    const [opportunity] = await sql<{ id: string }>(
      "select id from public.opportunities where slug = 'ai-literacy-research-assistant'",
    );
    const [skill] = await sql<{ id: string }>(
      "select id from public.verified_skills where profile_id = $1",
      [l.id],
    );

    await asUser(l.id, (client) =>
      client.query("select public.apply_to_opportunity($1, $2, $3::uuid[])", [
        opportunity.id,
        "I have verified data interpretation work and want to build the rest here.",
        [skill.id],
      ]),
    );

    // Now the learner verifies more; the snapshot must not move.
    await proveCompetency(l.id, r.id, "brief-ai-limitations");
    const [application] = await sql<{ match_snapshot: { score: number } }>(
      "select match_snapshot from public.applications where profile_id = $1",
      [l.id],
    );
    expect(application.match_snapshot.score).toBe(40);
  });

  it("refuses to share another learner's verified skill", async () => {
    const [a, b, r] = await Promise.all([
      measuredLearner("share-a"),
      measuredLearner("share-b"),
      makeReviewer("rev-share"),
    ]);
    await proveCompetency(b.id, r.id, "brief-data-interpretation");
    const [othersSkill] = await sql<{ id: string }>(
      "select id from public.verified_skills where profile_id = $1",
      [b.id],
    );
    const [opportunity] = await sql<{ id: string }>(
      "select id from public.opportunities where slug = 'ai-literacy-research-assistant'",
    );

    const rejection = await expectRejection(
      asUser(a.id, (client) =>
        client.query("select public.apply_to_opportunity($1, null, $2::uuid[])", [
          opportunity.id,
          [othersSkill.id],
        ]),
      ),
    );
    expect(rejection.code).toBe("42501");
  });

  it("refuses a second application to the same opening", async () => {
    const l = await measuredLearner("twice");
    const [opportunity] = await sql<{ id: string }>(
      "select id from public.opportunities where slug = 'ai-literacy-research-assistant'",
    );
    await asUser(l.id, (client) =>
      client.query("select public.apply_to_opportunity($1)", [opportunity.id]),
    );
    const rejection = await expectRejection(
      asUser(l.id, (client) =>
        client.query("select public.apply_to_opportunity($1)", [opportunity.id]),
      ),
    );
    expect(rejection.code).toBe("23505");
  });

  it("refuses an application to an opening that is not open", async () => {
    const l = await measuredLearner("closed");
    const [opportunity] = await sql<{ id: string }>(
      "select id from public.opportunities where slug = 'ai-literacy-research-assistant'",
    );
    await sql("update public.opportunities set status = 'closed' where id = $1", [opportunity.id]);
    const rejection = await expectRejection(
      asUser(l.id, (client) =>
        client.query("select public.apply_to_opportunity($1)", [opportunity.id]),
      ),
    );
    expect(rejection.message).toContain("not open");
    await sql("update public.opportunities set status = 'open' where id = $1", [opportunity.id]);
  });

  it("shows an employer only the skills the applicant chose to share", async () => {
    const [l, r, employer] = await Promise.all([
      measuredLearner("discloser"),
      makeReviewer("rev-disclose"),
      createUser("employer-admin"),
    ]);
    await proveCompetency(l.id, r.id, "brief-data-interpretation");
    await proveCompetency(l.id, r.id, "brief-ai-limitations");

    const [org] = await sql<{ id: string }>(
      "select id from public.organizations where slug = 'btg-partner-network'",
    );
    await sql(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'employer', 'active', now())`,
      [org.id, employer.id],
    );

    const skills = await sql<{ id: string; slug: string }>(
      `select vs.id, c.slug from public.verified_skills vs
       join public.competencies c on c.id = vs.competency_id where vs.profile_id = $1 order by c.slug`,
      [l.id],
    );
    const shared = skills.find((s) => s.slug === "data-interpretation")!;
    const withheld = skills.find((s) => s.slug === "ai-limitations")!;

    const [opportunity] = await sql<{ id: string }>(
      "select id from public.opportunities where slug = 'ai-literacy-research-assistant'",
    );
    const [application] = await asUser(l.id, async (client) => {
      const result = await client.query(
        "select (public.apply_to_opportunity($1, null, $2::uuid[])).id as id",
        [opportunity.id, [shared.id]],
      );
      return result.rows as { id: string }[];
    });

    // Scoped to this application: the opening carries others from earlier tests.
    const visible = await asUser(employer.id, async (client) => {
      const result = await client.query(
        "select verified_skill_id, competency_slug, applicant_name from public.application_evidence_view where application_id = $1",
        [application.id],
      );
      return result.rows as Array<{ verified_skill_id: string | null; competency_slug: string | null; applicant_name: string }>;
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].verified_skill_id).toBe(shared.id);
    expect(visible[0].competency_slug).toBe("data-interpretation");
    expect(visible[0].applicant_name).toBe("discloser");

    // The withheld skill is not readable by that employer.
    const leak = await asUser(employer.id, async (client) => {
      const result = await client.query("select id from public.verified_skills where id = $1", [withheld.id]);
      return result.rowCount;
    });
    expect(leak).toBe(0);
  });

  it("withdrawing hides the applicant from the employer again", async () => {
    const [l, employer] = await Promise.all([measuredLearner("withdrawer"), createUser("employer-2")]);
    const [org] = await sql<{ id: string }>(
      "select id from public.organizations where slug = 'btg-partner-network'",
    );
    await sql(
      `insert into public.memberships (organization_id, profile_id, persona, status, activated_at)
       values ($1, $2, 'employer', 'active', now())`,
      [org.id, employer.id],
    );
    const [opportunity] = await sql<{ id: string }>(
      "select id from public.opportunities where slug = 'ai-literacy-research-assistant'",
    );
    const [app] = await asUser(l.id, async (client) => {
      const result = await client.query("select (public.apply_to_opportunity($1)).id as id", [opportunity.id]);
      return result.rows as { id: string }[];
    });

    let seen = await asUser(employer.id, async (client) => {
      const result = await client.query("select id from public.applications where id = $1", [app.id]);
      return result.rowCount;
    });
    expect(seen).toBe(1);

    await asUser(l.id, (client) => client.query("select public.withdraw_application($1)", [app.id]));

    const [row] = await sql<{ status: string }>("select status from public.applications where id = $1", [app.id]);
    expect(row.status).toBe("withdrawn");

    // The row is still visible to the employer, but the applicant's profile is not.
    seen = await asUser(employer.id, async (client) => {
      const result = await client.query("select id from public.profiles where id = $1", [l.id]);
      return result.rowCount;
    });
    expect(seen).toBe(0);
  });
});

describe("mentorship recommendations use real state", () => {
  async function makeMentor(label: string, competencySlugs: string[], capacity = 3) {
    const mentor = await createUser(label);
    await sql(
      `insert into public.mentor_profiles (profile_id, headline, monthly_capacity, is_accepting)
       values ($1, $2, $3, true)`,
      [mentor.id, `${label} — works in the field`, capacity],
    );
    await sql(
      `insert into public.mentor_expertise (profile_id, competency_id)
       select $1, id from public.competencies where slug = any($2)`,
      [mentor.id, competencySlugs],
    );
    return mentor;
  }

  it("ranks mentors by how much of the open pathway they cover, and says so", async () => {
    const l = await measuredLearner("mentee");
    await generatePathwayOnce(l.id);

    const broad = await makeMentor("mentor-broad", ["ai-concepts", "ai-limitations", "data-interpretation"]);
    await makeMentor("mentor-narrow", ["ai-concepts"]);
    await makeMentor("mentor-irrelevant", ["applied-ai-projects"]); // locked step, not open

    const recommendations = await asUser(l.id, async (client) => {
      const result = await client.query("select * from public.recommend_mentors(5)");
      return result.rows as Array<{
        mentor_name: string;
        covered_count: number;
        open_step_count: number;
        rationale: string;
      }>;
    });

    expect(recommendations[0].mentor_name).toBe("mentor-broad");
    expect(recommendations[0].covered_count).toBe(3);
    expect(recommendations[0].open_step_count).toBe(3);
    expect(recommendations[0].rationale).toContain("Covers 3 of your 3 open pathway steps");
    // A mentor whose only expertise maps to a locked step is not recommended.
    expect(recommendations.map((r) => r.mentor_name)).not.toContain("mentor-irrelevant");
    expect(broad.id).toBeTruthy();
  });

  it("refuses a request to a mentor at capacity", async () => {
    const l = await measuredLearner("capped-mentee");
    await generatePathwayOnce(l.id);
    const mentor = await makeMentor("mentor-capped", ["ai-concepts"], 1);

    const other = await createUser("other-mentee");
    await sql(
      `insert into public.mentorships (mentor_profile_id, learner_profile_id, status, responded_at)
       values ($1, $2, 'accepted', now())`,
      [mentor.id, other.id],
    );

    const rejection = await expectRejection(
      asUser(l.id, (client) =>
        client.query("select public.request_mentorship($1)", [mentor.id]),
      ),
    );
    expect(rejection.message).toContain("at capacity");
  });

  it("records why a pairing was proposed, and notifies the mentor", async () => {
    const l = await measuredLearner("recorded-mentee");
    await generatePathwayOnce(l.id);
    const mentor = await makeMentor("mentor-recorded", ["ai-concepts", "ai-limitations"]);

    await asUser(l.id, (client) =>
      client.query("select public.request_mentorship($1, null, $2)", [
        mentor.id,
        "I am stuck explaining model behaviour.",
      ]),
    );

    const [m] = await sql<{ status: string; rationale: { covered_competencies: string[] } }>(
      "select status, rationale from public.mentorships where learner_profile_id = $1",
      [l.id],
    );
    expect(m.status).toBe("requested");
    expect(m.rationale.covered_competencies.sort()).toEqual([
      "How AI systems work",
      "Recognising AI limitations",
    ]);

    const notifications = await sql<{ category: string }>(
      "select category from public.notifications where profile_id = $1",
      [mentor.id],
    );
    expect(notifications.map((n) => n.category)).toContain("mentorship.requested");
  });

  it("only the mentor may answer, and only once", async () => {
    const l = await measuredLearner("answer-mentee");
    await generatePathwayOnce(l.id);
    const mentor = await makeMentor("mentor-answer", ["ai-concepts"]);
    const [m] = await asUser(l.id, async (client) => {
      const result = await client.query("select (public.request_mentorship($1)).id as id", [mentor.id]);
      return result.rows as { id: string }[];
    });

    const denied = await expectRejection(
      asUser(l.id, (client) => client.query("select public.respond_to_mentorship($1, true)", [m.id])),
    );
    expect(denied.message).toContain("mentorship not found");

    await asUser(mentor.id, (client) =>
      client.query("select public.respond_to_mentorship($1, true, $2)", [m.id, "Happy to help."]),
    );
    const again = await expectRejection(
      asUser(mentor.id, (client) => client.query("select public.respond_to_mentorship($1, false)", [m.id])),
    );
    expect(again.message).toContain("already been answered");
  });

  it("lets an accepted mentor read the learner's competencies, and no one else's", async () => {
    const [l, other] = await Promise.all([
      measuredLearner("mentored"),
      measuredLearner("not-mentored"),
    ]);
    await generatePathwayOnce(l.id);
    const mentor = await makeMentor("mentor-reader", ["ai-concepts"]);
    const [m] = await asUser(l.id, async (client) => {
      const result = await client.query("select (public.request_mentorship($1)).id as id", [mentor.id]);
      return result.rows as { id: string }[];
    });
    await asUser(mentor.id, (client) =>
      client.query("select public.respond_to_mentorship($1, true, $2)", [m.id, "Yes."]),
    );

    const mentee = await asUser(mentor.id, async (client) => {
      const result = await client.query(
        "select competency_id from public.learner_competencies where profile_id = $1",
        [l.id],
      );
      return result.rowCount;
    });
    expect(mentee).toBe(8);

    const stranger = await asUser(mentor.id, async (client) => {
      const result = await client.query(
        "select competency_id from public.learner_competencies where profile_id = $1",
        [other.id],
      );
      return result.rowCount;
    });
    expect(stranger).toBe(0);
  });

  it("keeps mentor session notes out of the learner's reach", async () => {
    const l = await measuredLearner("noted-mentee");
    await generatePathwayOnce(l.id);
    const mentor = await makeMentor("mentor-notes", ["ai-concepts"]);
    const [m] = await asUser(l.id, async (client) => {
      const result = await client.query("select (public.request_mentorship($1)).id as id", [mentor.id]);
      return result.rows as { id: string }[];
    });
    await asUser(mentor.id, (client) =>
      client.query("select public.respond_to_mentorship($1, true, $2)", [m.id, "Yes."]),
    );

    const [session] = await sql<{ id: string }>(
      `insert into public.mentor_sessions (mentorship_id, scheduled_for)
       values ($1, now() + interval '2 days') returning id`,
      [m.id],
    );
    await asUser(mentor.id, (client) =>
      client.query(
        `insert into public.mentor_session_notes (session_id, mentor_profile_id, notes)
         values ($1, $2, 'They need more practice explaining behaviour without jargon.')`,
        [session.id, mentor.id],
      ),
    );

    // The mentor reads their own notes.
    const own = await asUser(mentor.id, async (client) => {
      const result = await client.query("select notes from public.mentor_session_notes where session_id = $1", [session.id]);
      return result.rowCount;
    });
    expect(own).toBe(1);

    // The learner sees the session but not the notes.
    const learnerSession = await asUser(l.id, async (client) => {
      const result = await client.query("select id from public.mentor_sessions where id = $1", [session.id]);
      return result.rowCount;
    });
    expect(learnerSession).toBe(1);

    const learnerNotes = await asUser(l.id, async (client) => {
      const result = await client.query("select notes from public.mentor_session_notes where session_id = $1", [session.id]);
      return result.rowCount;
    });
    expect(learnerNotes).toBe(0);
  });
});
