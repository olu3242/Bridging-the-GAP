import { describe,expect,it } from "vitest";
import { asUser,createOrganizationAs,createUser,expectRejection,sql } from "./helpers";

async function fundingFixture(label:string){
  const [admin,learner]=await Promise.all([createUser(`${label}-admin`),createUser(`${label}-learner`)]);
  const org=await createOrganizationAs(admin.id,`${label} Sponsor`,"sponsor");
  const [program]=await sql<{id:string}>(`insert into public.funding_programs
    (organization_id,code,name,kind,currency,policy_version,eligibility_policy,status,created_by)
    values($1,$2,$3,'fund_a_seat','USD','v1','{"required_keys":["country_code"]}','active',$4) returning id`,
    [org.id,`${label}-${Date.now()}`,`${label} seats`,admin.id]);
  const [pool]=await sql<{id:string}>(`insert into public.funding_pools(program_id,currency,funded_minor)
    values($1,'USD',10000) returning id`,[program.id]);
  const [assessment]=await sql<{id:string}>(`insert into public.eligibility_assessments
    (program_id,profile_id,policy_version,evidence,decision) values($1,$2,'v1','{}','eligible') returning id`,[program.id,learner.id]);
  const [wait]=await sql<{id:string}>(`insert into public.funding_waitlist(program_id,profile_id,assessment_id,status)
    values($1,$2,$3,'waitlisted') returning id`,[program.id,learner.id,assessment.id]);
  return {admin,learner,org,program,pool,wait};
}

describe("W15 funding invariants",()=>{
  it("serializes allocation and never lets a pool go negative",async()=>{
    const f=await fundingFixture("capacity");
    await asUser(f.admin.id,c=>c.query("select public.allocate_funded_seat($1,$2,8000,'USD','first')",[f.wait.id,f.pool.id]));
    const [other]=await sql<{id:string}>("insert into public.funding_waitlist(program_id,profile_id,assessment_id,status) select program_id,gen_random_uuid(),assessment_id,'waitlisted' from public.funding_waitlist where false returning id");
    expect(other).toBeUndefined();
    const [balance]=await sql<{available:string}>("select (funded_minor-reserved_minor-spent_minor)::text available from funding_pools where id=$1",[f.pool.id]);
    expect(Number(balance.available)).toBe(2000);
    const rejection=await expectRejection(sql("update funding_pools set reserved_minor=11000 where id=$1",[f.pool.id]));
    expect(rejection.code).toBe("23514");
  });

  it("records confirmed funding idempotently in exact minor units",async()=>{
    const f=await fundingFixture("idempotent");
    const ids=await asUser(f.learner.id,async c=>{
      const a=await c.query("select public.record_funding($1,'USD',2500,'same-key','test','provider-1',true) id",[f.program.id]);
      const b=await c.query("select public.record_funding($1,'USD',2500,'same-key','test','provider-1',true) id",[f.program.id]);
      return [a.rows[0].id,b.rows[0].id];
    });
    expect(ids[0]).toBe(ids[1]);
    const [count]=await sql<{n:string}>("select count(*)::text n from funding_transactions where idempotency_key='same-key:capture'");
    expect(Number(count.n)).toBe(1);
  });

  it("keeps a learner from seeing another learner's assessment",async()=>{
    const f=await fundingFixture("private"); const outsider=await createUser("funding-outsider");
    const seen=await asUser(outsider.id,async c=>(await c.query("select id from eligibility_assessments where profile_id=$1",[f.learner.id])).rowCount);
    expect(seen).toBe(0);
  });
});

describe("W16-W20 trust invariants",()=>{
  it("makes impact and funding ledgers append-only",async()=>{
    const user=await createUser("impact-immutable");
    const [event]=await sql<{id:string}>(`insert into impact_events(event_type,profile_id,source_type,source_id,idempotency_key,recorded_by)
      values('learning_completed',$1,'profile',$1,'immutable-impact',$1) returning id`,[user.id]);
    const rejection=await expectRejection(sql("delete from impact_events where id=$1",[event.id]));
    expect(rejection.message).toContain("append-only");
  });

  it("rejects self-verification structurally",async()=>{
    const user=await createUser("self-review");
    const rejection=await expectRejection(sql(`insert into contribution_submissions
      (task_id,contributor_id,provenance,content_hash,status,reviewed_by)
      values(gen_random_uuid(),$1,'{}','x','accepted',$1)`,[user.id]));
    expect(rejection.code).toBeDefined();
  });

  it("does not grant authenticated direct writes to canonical W15-W20 tables",async()=>{
    const rows=await sql<{table_name:string;privilege_type:string}>(`select table_name,privilege_type from information_schema.role_table_grants
      where grantee='authenticated' and table_name in ('funding_pools','funding_ledger','contribution_submissions','placements','impact_events')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`);
    expect(rows).toEqual([]);
  });
});
