import type { Metadata } from "next";
import { Database,ShieldCheck } from "lucide-react";
import { requireActor } from "@/server/services/actor";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getContributionWorkspace } from "@/server/services/flywheel-service";
import { claimContributionTaskAction } from "@/server/actions/flywheel";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Badge,EmptyState } from "@/components/ui/feedback";

export const metadata:Metadata={title:"Data Corps"};
export default async function ContributionsPage(){const actor=await requireActor();const supabase=await createSupabaseServerClient();const {available,mine,impact}=await getContributionWorkspace(supabase,actor.profileId);return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Data Corps and research</h1><p className="mt-1 text-sm text-ink-muted">Complete governed tasks, preserve provenance and earn verified contribution history.</p></div>
<Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-4 text-accent"/>Available work</CardTitle><CardDescription>Claiming a task assigns real work. Submission never means automatic verification.</CardDescription></CardHeader><CardContent className="space-y-3">{available.length===0?<EmptyState icon={Database} title="No tasks available" description="Published work will appear here."/>:available.map(t=><div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 p-4"><div><p className="font-medium">{t.title}</p><p className="max-w-2xl text-xs text-ink-subtle">{t.instructions}</p></div><form action={claimContributionTaskAction}><input type="hidden" name="taskId" value={t.id}/><Button size="sm">Claim task</Button></form></div>)}</CardContent></Card>
<Card><CardHeader><CardTitle>Your assignments</CardTitle></CardHeader><CardContent className="space-y-2">{mine.length===0?<p className="text-sm text-ink-muted">You have no assigned contribution work.</p>:mine.map(t=><div key={t.id} className="flex justify-between rounded-xl border border-white/8 p-3"><span>{t.title}</span><Badge tone="brand">{t.status}</Badge></div>)}</CardContent></Card>
<Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-accent"/>Verified impact</CardTitle><CardDescription>Only independently verified canonical events appear here.</CardDescription></CardHeader><CardContent>{impact.length===0?<p className="text-sm text-ink-muted">No verified contribution impact yet.</p>:<ul className="space-y-2">{impact.map(i=><li key={i.id} className="rounded-xl border border-white/8 p-3 text-sm">{i.event_type.replaceAll("_"," ")} · {i.source_type}</li>)}</ul>}</CardContent></Card></div>}
