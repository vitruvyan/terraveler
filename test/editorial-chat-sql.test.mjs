import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migrations=await Promise.all(['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline','editorial_chat'].map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
async function save(db,version=0,enabled=true,model='local-v1'){return scalar(db,`select desk_save_editorial_agent('coordinator','Coordinator','coordinator',$1,'Organize source-bound work',$2,$3,$4)`,[model,enabled,version,`coordinator-save-${version}`]);}
async function setup(){const db=new PGlite();await db.exec(`create role terraveler_service;create role visitor;create table submissions(id bigint primary key,status text,payload jsonb);insert into submissions values(111,'approved','{"title":"Cabeza"}');`);for(const sql of migrations)await db.exec(sql);const {topic_id}=await scalar(db,`select editorial_start(111,'cabeza','Cabeza','Reconcile sources')`);await save(db);return {db,topic:topic_id};}
async function begin(db,topic,id='chat-request-0001',message='Prepare this dossier'){return scalar(db,'select editorial_chat_begin($1,$2,$3)',[topic,message,id]);}
async function complete(db,t,action='reply',reply='I can prepare this.',brief=null){return scalar(db,'select editorial_chat_complete($1,$2,$3,$4,$5)',[t.request_id,t.lease_token,action,reply,brief]);}

test('chat persists messages, deduplicates requests and executes pipeline once transactionally',async()=>{const {db,topic}=await setup();try{
 const t=await begin(db,topic);assert.equal(t.agent_config.model,'local-v1');const duplicate=await begin(db,topic);assert.equal(duplicate.error,'request-in-progress');assert.equal(duplicate.lease_token,undefined);
 const receipt=await complete(db,t,'start_pipeline','Preparing one article.','Reconcile historical accounts');assert.ok(receipt.action_receipt.run_id);assert.match(receipt.reply,/queued/);assert.doesNotMatch(receipt.reply,/Preparing one article/);
 const replay=await complete(db,t,'start_pipeline','Preparing one article.','Reconcile historical accounts');assert.deepEqual(replay,receipt);
 await db.exec(migrations[4]);assert.deepEqual(await begin(db,topic),receipt);
 assert.equal(await scalar(db,'select count(*)::int from editorial_pipeline_runs'),1);assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),2);
 await assert.rejects(begin(db,topic,t.request_id,'Changed instruction'),/idempotency conflict/);
 await assert.rejects(complete(db,{...t,lease_token:'00000000-0000-0000-0000-000000000000'},'start_pipeline','Preparing one article.','Reconcile historical accounts'),/completion conflict/);
 }finally{await db.close();}});

test('frozen coordinator survives edits; pause revokes actions and retries cannot switch identity',async()=>{const {db,topic}=await setup();try{
 const t=await begin(db,topic);await save(db,1,true,'new-model');await save(db,2,false);
 await assert.rejects(complete(db,t),/coordinator unavailable/);assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),1);
 await scalar(db,'select editorial_chat_fail($1,$2,$3)',[t.request_id,t.lease_token,'secret-provider-output']);
 assert.equal((await begin(db,topic)).error,'coordinator-unavailable');await save(db,3,true,'latest-model');
 const retry=await begin(db,topic);assert.equal(retry.agent_config.model,'local-v1');assert.notEqual(retry.lease_token,t.lease_token);
 await assert.rejects(complete(db,t),/stale chat lease/);await complete(db,retry);
 }finally{await db.close();}});

test('leases recover boundedly, errors are safe and messages remain durable',async()=>{const {db,topic}=await setup();try{
 let t=await begin(db,topic);
 await scalar(db,'select editorial_chat_fail($1,$2,$3)',[t.request_id,t.lease_token,'sk-secret-api-key']);
 assert.equal(await scalar(db,'select error from editorial_chat_requests'),'coordinator-request-failed');
 t=await begin(db,topic);await db.exec(`update editorial_chat_requests set lease_expires_at=clock_timestamp()-interval '1 second'`);
 await assert.rejects(complete(db,t),/stale chat lease/);t=await begin(db,topic);
 await scalar(db,'select editorial_chat_fail($1,$2,$3)',[t.request_id,t.lease_token,'failure']);assert.equal((await begin(db,topic)).error,'retry-limit');
 assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),1);assert.equal(await scalar(db,'select attempt from editorial_chat_requests'),3);
 }finally{await db.close();}});

test('unsupported actions cannot publish and failed atomic actions leave no assistant response',async()=>{const {db,topic}=await setup();try{
 const t=await begin(db,topic);await assert.rejects(complete(db,t,'publish'),/invalid chat action/);
 await scalar(db,`select editorial_start_pipeline($1,'Existing work','existing-request-001')`,[topic]);
 await assert.rejects(complete(db,t,'start_pipeline','Starting','Another article'),/already active/);
 assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),1);assert.equal(await scalar(db,'select state from editorial_chat_requests'),'running');
 const answer=await complete(db,t);assert.equal(answer.action_receipt,null);assert.match(answer.reply,/No new work/);assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),2);
 }finally{await db.close();}});

test('chat history is immutable and service authority is limited to reads and RPCs',async()=>{const {db,topic}=await setup();try{
 await begin(db,topic);await assert.rejects(db.exec('delete from editorial_chat_messages'),/append-only/);
 await db.exec('set role terraveler_service');assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),1);
 await assert.rejects(db.exec("update editorial_chat_requests set state='completed'"),/permission denied/);await assert.rejects(db.exec('select editorial_chat_agent(1)'),/permission denied/);
 await db.exec('reset role;set role visitor');await assert.rejects(db.exec('select * from editorial_chat_messages'),/permission denied/);await assert.rejects(begin(db,topic),/permission denied/);
 }finally{await db.close();}});

test('unavailable coordinator preserves the user request and can bind when restored',async()=>{const {db,topic}=await setup();try{
 await save(db,1,false);assert.equal((await begin(db,topic)).error,'coordinator-unavailable');
 assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),1);assert.equal(await scalar(db,'select attempt from editorial_chat_requests'),0);
 await save(db,2,true);const t=await begin(db,topic);assert.equal(t.agent_config.version,3);await complete(db,t);
 assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),2);
 }finally{await db.close();}});
