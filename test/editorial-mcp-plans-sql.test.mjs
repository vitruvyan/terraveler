import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const [workflow, migration, team, preparation, corpus] = await Promise.all(['editorial_workflow', 'editorial_mcp_plans','editorial_team','editorial_preparation','editorial_mcp_corpus'].map(n => readFile(new URL(`../supabase/${n}.sql`, import.meta.url), 'utf8')));
const url = 'https://en.wikipedia.org/wiki/Example';
const fakeId = '00000000-0000-4000-8000-000000000099';
const digest = value => createHash('sha256').update(value).digest('hex');
async function scalar(db, sql, args = []) { return Object.values((await db.query(sql,args)).rows[0])[0]; }
async function setup() {
 const db = new PGlite();
 await db.exec(`create role terraveler_service;create role visitor;create role anon;create role authenticated;create role terraveler_editorial_worker;
 create table submissions(id bigint primary key,status text,payload jsonb);
 alter default privileges in schema public grant all on tables to anon,authenticated,terraveler_editorial_worker;
 alter default privileges in schema public grant execute on functions to anon,authenticated,terraveler_editorial_worker;`);
 await db.exec(workflow);await db.exec(migration);await db.exec(team);await db.exec(preparation);
 await db.exec(`create table rag_docs(id bigint primary key,voyage_slug text,type text,title text,content text,source_url text,license text);create table source_endpoints(id bigint primary key,host_pattern text,match_type text,status text,trust_mode text);create table source_policy_decisions(id bigint primary key,endpoint_id bigint,decision_outcome text,trust_mode text,rights_class text,timestamp timestamptz);`);await db.exec(corpus);
 await db.exec("insert into editorial_topics(topic_key,title,objective) values('example','Example','Research'),('another','Another','Research');");
 return db;
}
function orientation(patch={}) { return {kind:'wikipedia-orientation',purpose:'planning-only',requested_url:url,revision_id:123,sections:[{index:'1',title:'Itinerary'}],text:'An orientation paragraph.',text_truncated:false,sections_truncated:false,external_links_truncated:false,...patch}; }
async function record(db,body=orientation(),tool='get_wikipedia_outline',args={url}) { return scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',[tool,args,JSON.stringify(body)]); }
function plan(receipt) { return {orientation_receipt_id:receipt.id,gaps:['Date uncertainty'],work_items:[{id:'history',question:'Which events?',deliverable:'Cited chronology',specialty:'history',depends_on:[],source_receipt_ids:[]},{id:'diary',question:'How to compose?',deliverable:'Sourced draft',specialty:'diary',depends_on:['history'],source_receipt_ids:[receipt.id]}]}; }
async function save(db,body,version=0,request='editorial-plan-request-0001',topic=1) { return scalar(db,'select editorial_save_plan($1,$2,$3,$4)',[topic,version,request,body]); }

test('consultation bytes and hashes are server-owned and history cannot be rewritten',async()=>{const db=await setup();try{
 await db.exec('set role terraveler_service');
 const snapshot=orientation();const rec=await record(db,snapshot);
 assert.equal(rec.response_sha256,digest(JSON.stringify(snapshot)));assert.match(rec.arguments_sha256,/^[a-f0-9]{64}$/);assert.ok(rec.created_at);
 const row=(await db.query('select response_text,response from editorial_mcp_consultations where id=$1',[rec.id])).rows[0];
 assert.equal(row.response_text,JSON.stringify(snapshot));assert.deepEqual(row.response,snapshot);
 await assert.rejects(db.exec("insert into editorial_mcp_consultations(tool) values('fetch_source_text')"),/permission denied/);
 await db.exec('reset role');
 for(const q of ['update editorial_mcp_consultations set tool=tool','delete from editorial_mcp_consultations','truncate editorial_mcp_consultations cascade']) await assert.rejects(db.exec(q),/append-only/);
 await db.exec(migration);assert.equal(await scalar(db,'select count(*)::int from editorial_mcp_consultations'),1);
 }finally{await db.close();}});

test('public, contributor and worker roles cannot fabricate receipts or plans',async()=>{const db=await setup();try{
 for(const role of ['visitor','anon','authenticated','terraveler_editorial_worker']){
  await db.exec(`set role ${role}`);
  await assert.rejects(record(db),/permission denied/);
  await assert.rejects(save(db,{orientation_receipt_id:fakeId}),/permission denied/);
  await assert.rejects(db.exec('select * from editorial_mcp_consultations'),/permission denied/);
  await assert.rejects(db.exec('select * from editorial_plans'),/permission denied/);
  await db.exec('reset role');
 }
 }finally{await db.close();}});

test('plan versions lock intent, replay exact requests and never become execution approval',async()=>{const db=await setup();try{
 const rec=await record(db);const body=plan(rec);await db.exec('set role terraveler_service');
 const first=await save(db,body);assert.equal(first.version,1);assert.equal(first.state,'proposed');assert.equal(first.replayed,false);
 const second=await save(db,{...body,gaps:['Updated uncertainty']},1,'editorial-plan-request-0002');assert.equal(second.version,2);
 assert.equal((await save(db,body)).replayed,true,'an old request replays before checking today version');
 await assert.rejects(save(db,{...body,gaps:['changed']}),/idempotency conflict/);
 await assert.rejects(save(db,body,0,'editorial-plan-stale-0003'),/version conflict/);
 await assert.rejects(save(db,body,0,'editorial-plan-request-0001',2),/idempotency conflict/);
 await assert.rejects(db.exec('update editorial_plans set state=state'),/permission denied/);
 await db.exec('reset role');
 for(const q of ['update editorial_plans set state=state','delete from editorial_plans','truncate editorial_plans cascade']) await assert.rejects(db.exec(q),/append-only/);
 assert.equal(await scalar(db,'select count(*)::int from editorial_tasks'),0,'proposing a plan never starts work');
 }finally{await db.close();}});

test('plans require real complete orientation, known receipts and an acyclic bounded work graph',async()=>{const db=await setup();try{
 const rec=await record(db);const base=plan(rec);let serial=0;
 const reject=body=>assert.rejects(save(db,body,0,`invalid-plan-request-${String(++serial).padStart(4,'0')}`));
 await reject({...base,orientation_receipt_id:fakeId});
 const truncated=await record(db,orientation({text_truncated:true}));await reject(plan(truncated));
 const noSections=await record(db,orientation({sections:[]}));await reject(plan(noSections));
 const source={url,kind:'wikipedia',lang:null,text:'A read source paragraph.',truncated:false,total_length:24};
 const sourceReceipt=await record(db,source,'fetch_source_text',{url,kind:'wikipedia',lang:null});await reject(plan(sourceReceipt));
 for(const mutate of [
  p=>p.work_items[0].depends_on=['diary'], p=>p.work_items[0].depends_on=['unknown'],
  p=>p.work_items[0].source_receipt_ids=[fakeId], p=>p.work_items[0].specialty='publisher',
  p=>p.work_items[1].id='history', p=>p.work_items[0].source_receipt_ids=[rec.id,rec.id],
  p=>p.via_mcp=true, p=>p.work_items[0].question=' ', p=>p.work_items[0].question='\n\t', p=>p.gaps=['\n'], p=>p.work_items[0].id='1bad',
 ]){const p=structuredClone(base);mutate(p);await reject(p);}
 await assert.rejects(record(db,orientation({requested_url:'https://en.wikipedia.org/wiki/Other'})),/invalid orientation/);
 await assert.rejects(record(db,orientation({revision_id:0})),/invalid orientation revision/);
 await assert.rejects(record(db,orientation({text:''})),/text and URL/);
 await assert.rejects(record(db,orientation({text:'\n\t'})),/text and URL/);
 await assert.rejects(record(db,source,'fetch_source_text',{url,kind:'gutenberg',lang:null}),/invalid source response/);
 }finally{await db.close();}});

test('prepared plan and independent review are atomic, immutable and grant no task authority',async()=>{const db=await setup();try{
 const rec=await record(db); const body=plan(rec);body.work_items[1].source_receipt_ids=[];
 await db.exec('set role terraveler_service');
 for(const [key,role] of [['planner','coordinator'],['reviewer','reviewer']]){
  await scalar(db,'select desk_save_editorial_agent($1,$1,$2,$3,$4,true,0,$5)',[key,role,'local','instructions','agent-request-'+key+'-0001']);
 }
 const review={verdict:'adequate-for-next-stage',issues:[]},req='preparation-request-0001';
 const invoke=(p=body,r=review,reviewer=2,request=req)=>scalar(db,'select editorial_record_preparation($1,$2,$3,$4,$5,$6,$7,$8,$9)',[1,0,request,null,url,p,1,reviewer,r]);
 await assert.rejects(invoke(body,review,1),/independent configured agents/);
 await assert.rejects(invoke(body,{verdict:'adequate-for-next-stage',issues:['unresolved']}),/invalid plan review issues/);
 const forged=structuredClone(body);forged.work_items[0].source_receipt_ids=[rec.id];
 await assert.rejects(invoke(forged),/cannot claim completed source analysis/);
 const saved=await invoke();assert.equal(saved.plan_id,1);assert.equal(saved.replayed,false);
 assert.equal((await invoke()).replayed,true);
 await assert.rejects(db.exec("update editorial_plan_preparations set review=review"),/permission denied/);
 await db.exec('reset role');
 await assert.rejects(db.exec('delete from editorial_plan_preparations'),/append-only/);
 assert.equal(await scalar(db,'select count(*)::int from editorial_tasks'),0);
 for(const role of ['visitor','anon','authenticated','terraveler_editorial_worker']){
  await db.exec('set role '+role);await assert.rejects(invoke(),/permission denied/);await db.exec('reset role');
 }
 }finally{await db.close();}});

test('MCP corpus is scoped to a live research attempt and persists current policy receipt',async()=>{const db=await setup();try{
 await db.exec(`insert into submissions values(7,'approved','{}');
 insert into editorial_topic_submissions(submission_id,topic_id,snapshot) values(7,1,'{"target_voyage":"voyage"}');
 insert into rag_docs values(1,'voyage','text','Journal','A source fragment','https://example.org/book','Public domain'),(2,'other','text','Other','unscoped','https://example.org/book','Public domain'),(3,'voyage','text','Restricted','private text','https://example.org/restricted','Copyright');
 insert into source_endpoints values(1,'example.org','exact','active','domain_trusted');
 insert into source_policy_decisions values(1,1,'approve','domain_trusted','public_domain',now());`);
 await scalar(db,"select editorial_enqueue(1,'research','test-corpus','{}',null)");
 await scalar(db,"select editorial_claim('worker-1',array['research'],120)");
 const invoke=(attempt=1,worker='worker-1')=>scalar(db,'select editorial_read_mcp_corpus(1,$1,$2)',[attempt,worker]);
 await db.exec('set role terraveler_service');
 await assert.rejects(invoke(2),/active research task required/);await assert.rejects(invoke(1,'foreign'),/active research task required/);
 const result=await invoke();assert.equal(result.sources.length,1);assert.equal(result.sources[0].id,'rag:1');assert.equal(result.sources[0].governance.policy_decision_id,1);
 assert.match(result.consultation.snapshot_sha256,/^[a-f0-9]{64}$/);
 await db.exec('reset role');
 await db.exec("insert into source_policy_decisions values(2,1,'reject',null,'unknown',now()+interval '1 second')");
 await assert.rejects(invoke(),/no approved corpus sources/);
 await assert.rejects(db.exec('delete from editorial_corpus_consultations'),/append-only/);
 await db.exec('set role terraveler_editorial_worker');await assert.rejects(invoke(),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}});
