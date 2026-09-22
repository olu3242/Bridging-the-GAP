import type {Metadata} from "next";
import {Lightbulb} from "lucide-react";
import {requireActor} from "@/server/services/actor";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {listChallenges} from "@/server/services/flywheel-service";
import {applyToChallengeAction} from "@/server/actions/flywheel";
import {Button} from "@/components/ui/button";
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from "@/components/ui/card";
import {Badge,EmptyState} from "@/components/ui/feedback";
export const metadata:Metadata={title:"Challenges"};
export default async function ChallengesPage(){await requireActor();const supabase=await createSupabaseServerClient();const challenges=await listChallenges(supabase);return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Challenge marketplace</h1><p className="mt-1 text-sm text-ink-muted">Real organization problems using the same governed project, evidence and review system.</p></div><Card><CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-accent"/>Open challenges</CardTitle><CardDescription>Acceptance requires independently reviewed evidence; applying is not an outcome.</CardDescription></CardHeader><CardContent className="space-y-3">{challenges.length===0?<EmptyState icon={Lightbulb} title="No open challenges" description="Governed challenges will appear here."/>:challenges.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 p-4"><div className="max-w-2xl"><Badge tone="brand">{c.status}</Badge><p className="mt-2 text-sm">{c.problem_statement}</p></div><form action={applyToChallengeAction}><input type="hidden" name="challengeId" value={c.id}/><Button size="sm">Start challenge</Button></form></div>)}</CardContent></Card></div>}
