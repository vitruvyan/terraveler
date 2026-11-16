import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migrations=await Promise.all(['editorial_workflow','editorial_team','editorial_agent_binding','editorial_specialists'].map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
async function save(db,key,version=0,options={}){return scalar(db,`select desk_save_editorial_agent($1,$1,$2,$3,'Follow evidence rules',$4,$5,$6)`,[key,options.role??'research',options.model??'local-'+key,options.enabled??true,version,`${key}-save-request-${version}`]);}
async function setup(){const db=new PGlite();await db.exec(`create role terraveler_service;create role visitor;create table submissions(id bigint primary key,status text,payload jsonb);insert into submissions values(111,'approved','{"title":"Cabeza"}');`);for(const sql of migrations)await db.exec(sql);const topic=await scalar(db,`select editorial_start(111,'cabeza','Cabeza','Reconcile sources')`);await save(db,'research-a');await save(db,'research-b');return {db,topic};}
async function assign(db,task,key='research-b',specialty='history',request='specialist-request-0001'){return scalar(db,'select editorial_assign_specialist($1,$2,$3,$4)',[task,key,specialty,request]);}
async function claim(db,role='research'){return scalar(db,`select editorial_claim('worker',array[$1]::text[],120)`,[role]);}

test('explicit specialist identity overrides lexical first-agent selection without replacing version binding',async()=>{const {db,topic}=await setup();try{
 const receipt=await assign(db,topic.task_id);assert.equal(receipt.replayed,false);
 const t=await claim(db);assert.equal(t.agent_config.agent_key,'research-b');assert.equal(t.agent_config.model,'local-research-b');assert.deepEqual(t.specialist_assignment,{agent_key:'research-b',specialty:'history'});
 assert.equal(await scalar(db,'select count(*)::int from editorial_task_agents'),1);
 const replay=await assign(db,topic.task_id);assert.equal(replay.replayed,true); // receipt lookup after claim
 await assert.rejects(assign(db,topic.task_id,'research-a','history','specialist-request-0002'),/already assigned/);
 }finally{await db.close();}});

test('paused assigned agent leaves work queued without fallback or consumed attempts',async()=>{const {db,topic}=await setup();try{
 await assign(db,topic.task_id);await save(db,'research-b',1,{enabled:false});
 assert.equal(await claim(db),null);assert.equal(await scalar(db,'select attempt from editorial_tasks where id=$1',[topic.task_id]),0);
 await save(db,'research-b',2,{model:'chosen-v3'});const first=await claim(db);assert.equal(first.agent_config.model,'chosen-v3');
 await scalar(db,'select editorial_fail($1,$2,$3)',[first.id,first.lease_token,'retry']);await save(db,'research-b',3,{model:'new-v4'});
 const retry=await claim(db);assert.deepEqual(retry.agent_config,first.agent_config);assert.notEqual(retry.lease_token,first.lease_token);
 assert.deepEqual(retry.specialist_assignment,first.specialist_assignment);
 }finally{await db.close();}});

test('unassigned tasks preserve legacy dispatch; assignment is forbidden after any claim even if recovered',async()=>{const {db,topic}=await setup();try{
 const t=await claim(db);assert.equal(t.agent_config.agent_key,'research-a');assert.equal(t.specialist_assignment,null);
 await scalar(db,'select editorial_fail($1,$2,$3)',[t.id,t.lease_token,'retry']);
 await assert.rejects(assign(db,topic.task_id),/already claimed/);
 }finally{await db.close();}});

test('unknown, planned, missing, paused and role-mismatched assignments fail closed',async()=>{const {db,topic}=await setup();try{
 await assert.rejects(assign(db,topic.task_id,'research-b','publisher'),/unknown specialty/);
 for(const specialty of ['ethnohistory','itinerary','iconography','caption','editorial','copyedit','managing-editor'])await assert.rejects(assign(db,topic.task_id,'research-b',specialty),/handler not implemented/);
 await assert.rejects(assign(db,topic.task_id,'research-b','diary'),/role mismatch/);
 await assert.rejects(assign(db,topic.task_id,'missing-agent'),/agent unavailable/);
 await save(db,'research-b',1,{enabled:false});await assert.rejects(assign(db,topic.task_id),/agent unavailable/);
 assert.equal(await scalar(db,'select count(*)::int from editorial_specialist_assignments'),0);
 }finally{await db.close();}});

test('request keys and assignment records are immutable, service RPC is bounded and visitors cannot assign',async()=>{const {db,topic}=await setup();try{
 await db.exec('set role terraveler_service');await assign(db,topic.task_id);
 assert.equal(await scalar(db,'select count(*)::int from editorial_specialist_assignments'),1);
 await assert.rejects(assign(db,topic.task_id,'research-a'),/idempotency conflict/);
 await assert.rejects(db.exec("insert into editorial_specialist_assignments values(999,'research-a','history','rogue-request-0001',now())"),/permission denied/);
 await assert.rejects(db.exec('select editorial_specialty_role(\'history\')'),/permission denied/);
 await db.exec('reset role');await assert.rejects(db.exec('update editorial_specialist_assignments set specialty=specialty'),/append-only/);
 await db.exec(migrations[3]); // repeat deployment must not delete or change assignments
 assert.equal((await assign(db,topic.task_id)).replayed,true);
 await db.exec('set role visitor');await assert.rejects(assign(db,topic.task_id),/permission denied/);
 await assert.rejects(db.exec('select * from editorial_specialist_assignments'),/permission denied/);
 }finally{await db.close();}});

test('writer and reviewer assignments choose their named agents on existing handlers only',async()=>{const {db,topic}=await setup();try{
 for(const [role,specialty] of [['writer','diary'],['reviewer','factcheck']]){
  await save(db,role+'-a',0,{role});await save(db,role+'-b',0,{role});
  const task=await scalar(db,`select editorial_enqueue($1,$2,$3,'{}')`,[topic.topic_id,role,'test-'+role]);
  await assign(db,task.id,role+'-b',specialty,'specialist-request-'+role);
  const t=await claim(db,role);assert.equal(t.agent_config.agent_key,role+'-b');assert.equal(t.specialist_assignment.specialty,specialty);
 }
 }finally{await db.close();}});
