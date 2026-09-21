import type { Metadata } from "next";
import { CircleDollarSign,TicketCheck } from "lucide-react";
import { requireActor } from "@/server/services/actor";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessWorkspace } from "@/server/services/flywheel-service";
import { activateSeatAction,evaluateEligibilityAction,joinWaitlistAction } from "@/server/actions/flywheel";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Badge,EmptyState } from "@/components/ui/feedback";

export const metadata:Metadata={title:"Funding access"};
export default async function AccessPage(){
 const actor=await requireActor(); const supabase=await createSupabaseServerClient();
 const {programs,assessments,seats,waitlist}=await getAccessWorkspace(supabase,actor.profileId);
 const assessmentByProgram=new Map(assessments.map(a=>[a.program_id,a]));
 return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Funding access</h1><p className="mt-1 text-sm text-ink-muted">Eligibility, waitlists and sponsored seats are policy-driven and auditable.</p></div>
 <Card><CardHeader><CardTitle className="flex items-center gap-2"><CircleDollarSign className="size-4 text-accent"/>Programs</CardTitle><CardDescription>Assessment does not guarantee a seat. Allocation depends on verified eligibility and real available funding.</CardDescription></CardHeader><CardContent className="space-y-3">
 {programs.length===0?<EmptyState icon={CircleDollarSign} title="No active funding programs" description="Available programs will appear here."/>:programs.map(p=>{const a=assessmentByProgram.get(p.id);const queued=waitlist.find(w=>w.program_id===p.id);return <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 p-4"><div><p className="font-medium">{p.name}</p><p className="text-xs text-ink-subtle">{p.kind.replaceAll("_"," ")} · policy {p.policy_version}</p></div><div className="flex items-center gap-2">{a&&<Badge tone={a.decision==="eligible"?"success":"neutral"}>{a.decision}</Badge>}{queued?<Badge tone="brand">{String(queued.status)}</Badge>:a?.decision==="eligible"?<form action={joinWaitlistAction}><input type="hidden" name="programId" value={p.id}/><input type="hidden" name="assessmentId" value={a.id}/><Button size="sm">Join waitlist</Button></form>:<form action={evaluateEligibilityAction}><input type="hidden" name="programId" value={p.id}/><Button size="sm" variant="secondary">Check eligibility</Button></form>}</div></div>})}
 </CardContent></Card>
 <Card><CardHeader><CardTitle className="flex items-center gap-2"><TicketCheck className="size-4 text-accent"/>Your seats</CardTitle></CardHeader><CardContent className="space-y-3">{seats.length===0?<EmptyState icon={TicketCheck} title="No seat allocated" description="An allocated seat appears after a successful match."/>:seats.map(s=><div key={s.id} className="flex items-center justify-between rounded-xl border border-white/8 p-4"><div><p className="font-medium">Sponsored learning seat</p><p className="text-xs text-ink-subtle">{s.currency} {(s.cost_minor/100).toFixed(2)}</p></div>{s.status==="allocated"?<form action={activateSeatAction}><input type="hidden" name="seatId" value={s.id}/><Button size="sm">Activate seat</Button></form>:<Badge tone="brand">{s.status}</Badge>}</div>)}</CardContent></Card></div>;
}
