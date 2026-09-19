import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { MentorRecommendations, MentorshipRequests } from "@/components/app/mentorship-panel";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActor } from "@/server/services/actor";
import { can, personasOf } from "@/domain/identity/actor";
import {
  listMyCohorts,
  listMyMentorships,
  recommendMentors,
} from "@/server/services/mentorship-service";
import { requestMentorshipAction, respondToMentorshipAction } from "@/server/actions/mentorship";
import { getMyWorkQueue } from "@/server/services/workflow-service";
import { WorkQueuePanel } from "@/components/app/work-queue-panel";
import { DomainError } from "@/domain/shared/errors";

export const metadata: Metadata = { title: "Mentorship" };

interface Cohort {
  id: string;
  name: string;
  description: string | null;
}

/** PostgREST returns an embedded relation as an object or a single-item array. */
interface CohortMembership {
  cohorts: Cohort | Cohort[] | null;
}

export default async function MentorshipPage() {
  const actor = await requireActor();
  const isMentor = can(actor, "mentorship.mentor_own");
  const isLearner = can(actor, "mentorship.request_own");
  if (!isMentor && !isLearner) {
    throw DomainError.forbidden("Mentorship is for learners and mentors.");
  }

  const supabase = await createSupabaseServerClient();
  const [mentorships, cohorts, recommendations, workQueue] = await Promise.all([
    listMyMentorships(supabase, actor.profileId),
    listMyCohorts(supabase, actor.profileId),
    isLearner ? recommendMentors(supabase, 5) : Promise.resolve([]),
    isMentor ? getMyWorkQueue(supabase, { workflow: "mentorship" }) : Promise.resolve([]),
  ]);

  const mine = mentorships.filter((m) => m.learner_profile_id === actor.profileId);
  const toMe = mentorships.filter((m) => m.mentor_profile_id === actor.profileId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mentorship</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Pairings come from your real pathway state, and every suggestion says why.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {personasOf(actor).map((persona) => (
            <Badge key={persona}>{persona}</Badge>
          ))}
        </div>
      </div>

      {isLearner ? (
        <MentorRecommendations recommendations={recommendations} action={requestMentorshipAction} />
      ) : null}

      {isMentor ? (
        <WorkQueuePanel
          rows={workQueue}
          title="Requests waiting on you"
          description="Answer the request below, then mark the step done — it only records the answer you already gave."
          emptyTitle="No requests waiting"
          emptyDescription="A learner's request appears here as soon as it is made."
        />
      ) : null}

      {isMentor ? (
        <MentorshipRequests
          mentorships={toMe}
          isMentorView
          action={respondToMentorshipAction}
        />
      ) : null}

      {isLearner ? (
        <MentorshipRequests mentorships={mine} isMentorView={false} action={respondToMentorshipAction} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your cohorts</CardTitle>
          <CardDescription>
            Community is scoped to groups you actually belong to — nothing broader is implied.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cohorts.length === 0 ? (
            <p className="text-sm text-ink-subtle">
              You are not in a cohort yet. Institutions and programmes create them.
            </p>
          ) : (
            <ul className="space-y-2">
              {(cohorts as unknown as CohortMembership[]).map((row) => {
                const cohort = Array.isArray(row.cohorts) ? row.cohorts[0] : row.cohorts;
                if (!cohort) return null;
                return (
                  <li
                    key={cohort.id}
                    className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                  >
                    <p className="text-sm text-ink">{cohort.name}</p>
                    {cohort.description ? (
                      <p className="mt-0.5 text-xs text-ink-subtle">{cohort.description}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
