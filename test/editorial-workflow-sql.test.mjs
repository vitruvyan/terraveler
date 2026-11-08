import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/editorial_workflow.sql', import.meta.url), 'utf8');
async function database() {
  const db = new PGlite();
  await db.exec(`create role terraveler_service; create role visitor;
    create table submissions(id bigint primary key,status text,payload jsonb);
    insert into submissions values(111,'approved','{"title":"Cabeza","sources":["archive"]}'),
      (112,'human-review','{}'),(113,'approved','{"title":"Estebanico"}');`);
  await db.exec(migration);
  return db;
}
async function scalar(db, sql, params=[]) { return Object.values((await db.query(sql,params)).rows[0])[0]; }
async function start(db, id=111) {
  return scalar(db, `select editorial_start($1,'cabeza','Cabeza de Vaca','Research the voyage')`,[id]);
}
async function claim(db) { return scalar(db, `select editorial_claim('worker-a',array['research'],120)`); }

test('approved sources share one dossier; retries conflict rather than overwrite intent', async()=>{
 const db=await database(); try {
  await assert.rejects(start(db,112),/approved submission required/);
  const a=await start(db); const b=await start(db); assert.equal(a.topic_id,b.topic_id); assert.equal(b.replayed,true);
  const c=await start(db,113); assert.equal(c.topic_id,a.topic_id); assert.notEqual(c.task_id,a.task_id);
  await assert.rejects(scalar(db,`select editorial_start(111,'cabeza','Changed title','Research the voyage')`),/idempotency conflict/);
  assert.equal(await scalar(db,`select count(*)::int from editorial_topics`),1);
  assert.deepEqual(await scalar(db,`select snapshot->'payload' from editorial_topic_submissions where submission_id=111`),{title:'Cabeza',sources:['archive']});
  // Idempotent migration must not erase or duplicate work.
  await db.exec(migration); assert.equal(await scalar(db,`select count(*)::int from editorial_tasks`),2);
 } finally {await db.close();}
});

test('claim fences leases; completion and history are immutable and idempotent',async()=>{
 const db=await database(); try {
  await start(db); const t=await claim(db); assert.equal(t.role,'research'); assert.equal(t.attempt,1); assert.equal(t.topic.topic_key,'cabeza'); assert.equal(t.sources.length,1);
  assert.equal(await claim(db),null);
  await assert.rejects(scalar(db,`select editorial_renew($1,$2,0)`,[t.id,t.lease_token]),/invalid lease/);
  assert.equal(await scalar(db,`select editorial_renew($1,gen_random_uuid(),120)`,[t.id]),false);
  await assert.rejects(scalar(db,`select editorial_complete($1,$2,jsonb_build_object('large',repeat('x',1048576)),'{}')`,[t.id,t.lease_token]),/too large/);
  await assert.rejects(scalar(db,`select editorial_complete($1,$2,'{}',jsonb_build_object('large',repeat('x',8388608)))`,[t.id,t.lease_token]),/too large/);
  assert.equal(await scalar(db,`select editorial_renew($1,$2,120)`,[t.id,t.lease_token]),true);
  await assert.rejects(scalar(db,`select editorial_complete($1,gen_random_uuid(),'{}','{}')`,[t.id]),/stale lease/);
  const args=[t.id,t.lease_token,{summary:'Candidate findings'},{nodes:['research']}];
  const a=await scalar(db,`select editorial_complete($1,$2,$3,$4)`,args);
  const b=await scalar(db,`select editorial_complete($1,$2,$3,$4)`,args); assert.equal(a.result_id,b.result_id); assert.equal(b.replayed,true);
  await assert.rejects(scalar(db,`select editorial_complete($1,$2,'{"different":true}','{}')`,[t.id,t.lease_token]),/completion conflict/);
  await assert.rejects(db.exec(`update editorial_results set result='{}'`),/append-only/);
  await assert.rejects(db.exec(`truncate editorial_task_events`),/append-only/);
  assert.equal(await scalar(db,`select count(*)::int from editorial_results`),1);
 } finally {await db.close();}
});

test('restart recovery rejects expired output and stops after bounded attempts',async()=>{
 const db=await database(); try {
  const {task_id}=await start(db); const stale=await claim(db);
  await db.exec(`update editorial_tasks set lease_expires_at=clock_timestamp()-interval '1 second' where id=${task_id}`);
  assert.equal(await scalar(db,`select editorial_renew($1,$2,120)`,[task_id,stale.lease_token]),false);
  await assert.rejects(scalar(db,`select editorial_complete($1,$2,'{}','{}')`,[task_id,stale.lease_token]),/stale lease/);
  assert.equal(await scalar(db,`select editorial_recover()`),1);
  const retry=await claim(db); assert.notEqual(retry.lease_token,stale.lease_token); assert.equal(retry.attempt,2);
  assert.equal(await scalar(db,`select editorial_fail($1,$2,'old attempt')`,[task_id,stale.lease_token]),false);
  await scalar(db,`select editorial_fail($1,$2,'timeout')`,[task_id,retry.lease_token]);
  const final=await claim(db); assert.equal(final.attempt,3);
  await scalar(db,`select editorial_fail($1,$2,'timeout')`,[task_id,final.lease_token]);
  assert.equal(await claim(db),null); assert.equal(await scalar(db,`select state from editorial_tasks where id=$1`,[task_id]),'attention');
  assert.equal(await scalar(db,`select count(*)::int from editorial_task_events where event='claimed'`),3);
 } finally {await db.close();}
});

test('dependencies wait for accepted completion, enforce same topic and immutable task keys',async()=>{
 const db=await database(); try {
  const {topic_id,task_id}=await start(db);
  const w=await scalar(db,`select editorial_enqueue($1,'writer','draft:1','{}',$2)`,[topic_id,task_id]);
  assert.equal(await scalar(db,`select editorial_claim('writer-a',array['writer'],120)`),null);
  await assert.rejects(scalar(db,`select editorial_enqueue($1,'reviewer','draft:1','{}',null)`,[topic_id]),/idempotency conflict/);
  const r=await claim(db); await scalar(db,`select editorial_complete($1,$2,'{"findings":[1]}','{}')`,[r.id,r.lease_token]);
  const ready=await scalar(db,`select editorial_claim('writer-a',array['writer'],120)`); assert.equal(ready.id,w.id); assert.deepEqual(ready.dependency_result,{findings:[1]});
  await db.exec(`insert into editorial_topics(topic_key,title,objective) values('other','Other','Other')`);
  await assert.rejects(scalar(db,`select editorial_enqueue((select id from editorial_topics where topic_key='other'),'writer','cross','{}',$1)`,[task_id]),/dependency must belong to topic/);
 } finally {await db.close();}
});

test('service can read and invoke RPCs but cannot directly mutate tables; visitors cannot invoke',async()=>{
 const db=await database(); try {
  await db.exec('set role terraveler_service'); const s=await start(db); assert.ok(s.topic_id);
  assert.equal(await scalar(db,'select count(*)::int from editorial_topics'),1);
  await assert.rejects(db.exec(`update editorial_tasks set state='completed'`),/permission denied/);
  await assert.rejects(db.exec(`insert into editorial_results(task_id,lease_token,result,trace) values(1,gen_random_uuid(),'{}','{}')`),/permission denied/);
  await db.exec('reset role; set role visitor');
  await assert.rejects(db.exec(`select editorial_recover()`),/permission denied/);
 } finally {await db.close();}
});
