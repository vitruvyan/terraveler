import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migrations=await Promise.all(['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline'].map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
async function scalar(db,sql,args=[]) {return Object.values((await db.query(sql,args)).rows[0])[0];}
async function setup(){const db=new PGlite(); await db.exec(`create role terraveler_service; create role visitor; create table submissions(id bigint primary key,status text,payload jsonb); insert into submissions values(111,'approved','{"title":"Cabeza"}');`);for(const s of migrations) await db.exec(s);
 const source=await scalar(db,`select editorial_start(111,'cabeza','Cabeza','Reconcile sources')`);
 // Intake is separate from the explicitly started synthesis pipeline.
 await db.exec(`update editorial_tasks set state='attention' where id=${source.task_id}`);
 for(const role of ['research','writer','reviewer']) await scalar(db,`select desk_save_editorial_agent($1,$1,$1,'local','Source-bound work',true,0,$2)`,[role,`${role}-request-0001`]);
 const run=await scalar(db,`select editorial_start_pipeline($1,'Prepare one sourced article','pipeline-request-0001')`,[source.topic_id]);return {db,run,topic:source.topic_id};}
async function work(db,role,result){const task=await scalar(db,`select editorial_claim('worker',array[$1]::text[],120)`,[role]);assert.ok(task); await scalar(db,`select editorial_complete($1,$2,$3,'{}')`,[task.id,task.lease_token,JSON.stringify(result)]);return task;}
async function state(db,id){return scalar(db,'select row_to_json(r) from editorial_pipeline_runs r where id=$1',[id]);}

test('durable pipeline schedules dependencies atomically and stops at human publication boundary',async()=>{const {db,run}=await setup();try{
 const research={kind:'research',findings:['evidence']};const rt=await work(db,'research',research);
 let r=await state(db,run.run_id);assert.equal(r.state,'writing');
 const writer=await work(db,'writer',{kind:'draft',title:'One article',body:'Sourced text'});assert.equal(writer.dependency_id,rt.id);assert.deepEqual(writer.input.research_result,research);
 await db.exec(migrations[3]); // migration/restart cannot duplicate stages
 const reviewer=await work(db,'reviewer',{kind:'review',verdict:'ready-for-editor'});assert.equal(reviewer.dependency_id,writer.id);assert.equal(reviewer.input.draft_result.title,'One article');
 r=await state(db,run.run_id);assert.equal(r.state,'awaiting-editor');assert.equal(r.draft_task_id,writer.id);assert.equal(await scalar(db,'select count(*)::int from editorial_pipeline_tasks'),3);
 assert.equal(await scalar(db,"select count(*)::int from submissions where status<>'approved'"),0);
 const newRun=await scalar(db,`select editorial_start_pipeline($1,'Editor explicitly requests changes','editor-revision-0001')`,[r.topic_id]);
 assert.notEqual(newRun.run_id,run.run_id); assert.equal((await state(db,run.run_id)).state,'awaiting-editor');
 }finally{await db.close();}});

test('rewrite context persists and a third rejection requires attention',async()=>{const {db,run}=await setup();try{
 await work(db,'research',{kind:'research',findings:['original']});
 for(let revision=0;revision<=2;revision++){
  const writer=await work(db,'writer',{kind:'draft',title:`Revision ${revision}`});assert.equal(writer.input.revision,revision);
  if(revision){assert.equal(writer.input.review_result.verdict,'changes-requested');assert.equal(writer.input.draft_result.title,`Revision ${revision-1}`);}
  await work(db,'reviewer',{kind:'review',verdict:'changes-requested'});
 }
 const r=await state(db,run.run_id);assert.equal(r.state,'attention');assert.equal(r.revision,2);assert.equal(r.attention_reason,'Rewrite limit reached');assert.equal(await scalar(db,'select count(*)::int from editorial_pipeline_tasks'),7);
 }finally{await db.close();}});

test('idempotency and one active pipeline per explicit topic',async()=>{const {db,run,topic}=await setup();try{
 const replay=await scalar(db,`select editorial_start_pipeline($1,'Prepare one sourced article','pipeline-request-0001')`,[topic]);assert.equal(replay.run_id,run.run_id);assert.equal(replay.replayed,true);
 await assert.rejects(scalar(db,`select editorial_start_pipeline($1,'Other brief','pipeline-request-0001')`,[topic]),/idempotency conflict/);
 await assert.rejects(scalar(db,`select editorial_start_pipeline($1,'Other brief','pipeline-request-0002')`,[topic]),/already active/);
 }finally{await db.close();}});

test('invalid artifacts remain immutable evidence and exhausted leases surface attention',async()=>{const {db,run}=await setup();try{
 await work(db,'research',{kind:'draft'});assert.equal((await state(db,run.run_id)).state,'attention');assert.equal(await scalar(db,'select count(*)::int from editorial_results'),1);
 const next=await scalar(db,`select editorial_start_pipeline((select topic_id from editorial_pipeline_runs where id=$1),'Retry deliberately','pipeline-request-0002')`,[run.run_id]);
 for(let i=0;i<3;i++){const t=await scalar(db,`select editorial_claim('worker',array['research'],120)`);await db.exec(`update editorial_tasks set lease_expires_at=clock_timestamp()-interval '1 second' where id=${t.id}`);await scalar(db,'select editorial_recover()');}
 assert.equal((await state(db,next.run_id)).state,'attention');assert.match((await state(db,next.run_id)).attention_reason,/retry budget/);
 }finally{await db.close();}});

test('service reads and fenced RPC only; visitors and model output cannot mutate authority',async()=>{const {db}=await setup();try{
 await assert.rejects(db.exec('update editorial_pipeline_tasks set revision=revision'),/append-only/);
 await db.exec('set role terraveler_service');assert.equal(await scalar(db,'select count(*)::int from editorial_pipeline_runs'),1);
 await assert.rejects(db.exec("update editorial_pipeline_runs set state='awaiting-editor'"),/permission denied/);
 await assert.rejects(db.exec('select editorial_pipeline_advance()'),/permission denied/);
 await db.exec('reset role; set role visitor');await assert.rejects(db.exec('select * from editorial_pipeline_runs'),/permission denied/);
 await assert.rejects(scalar(db,"select editorial_start_pipeline(1,'Brief','visitor-0001')"),/permission denied/);
 }finally{await db.close();}});

test('foreign results and stale completion cannot advance the current pipeline',async()=>{const {db,run,topic}=await setup();try{
 await scalar(db,`select editorial_enqueue($1,'research','independent-research','{}')`,[topic]);
 const current=await scalar(db,`select editorial_claim('worker',array['research'],120)`);
 await scalar(db,`select editorial_fail($1,$2,'retry')`,[current.id,current.lease_token]);
 const retry=await scalar(db,`select editorial_claim('worker',array['research'],120)`);
 await assert.rejects(scalar(db,`select editorial_complete($1,$2,'{"kind":"research"}','{}')`,[current.id,current.lease_token]),/stale lease/);
 assert.equal((await state(db,run.run_id)).state,'researching');
 await scalar(db,`select editorial_complete($1,$2,'{"kind":"research"}','{}')`,[retry.id,retry.lease_token]);
 const before=await state(db,run.run_id);
 await work(db,'research',{kind:'research',findings:['Unrelated']});
 assert.deepEqual(await state(db,run.run_id),before);
 assert.equal(await scalar(db,'select count(*)::int from editorial_pipeline_tasks'),2);
 }finally{await db.close();}});
test('attachment organizes proposals without enqueueing work, including retries',async()=>{const {db,topic}=await setup();try{
 await db.exec(`insert into submissions values(112,'approved','{"title":"More evidence"}')`);
 const before=await scalar(db,'select count(*)::int from editorial_tasks');
 const first=await scalar(db,`select editorial_attach(112,'cabeza','Cabeza','Reconcile sources')`);
 assert.equal(first.topic_id,topic);assert.equal(first.task_id,undefined);
 assert.equal((await scalar(db,`select editorial_attach(112,'cabeza','Cabeza','Reconcile sources')`)).replayed,true);
 assert.equal(await scalar(db,'select count(*)::int from editorial_tasks'),before);
 await db.exec('set role visitor');await assert.rejects(scalar(db,`select editorial_attach(112,'cabeza','Cabeza','Reconcile sources')`),/permission denied/);
 }finally{await db.close();}});
