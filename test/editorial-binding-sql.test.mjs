import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrations = await Promise.all(['editorial_workflow','editorial_team','editorial_agent_binding'].map(name => readFile(new URL(`../supabase/${name}.sql`, import.meta.url), 'utf8')));
async function database() {
 const db = new PGlite();
 await db.exec(`create role terraveler_service; create role visitor;
   create table submissions(id bigint primary key,status text,payload jsonb);
   insert into submissions values(111,'approved','{"title":"Cabeza"}');`);
 for (const sql of migrations) await db.exec(sql);
 return db;
}
async function scalar(db, sql, params=[]) { return Object.values((await db.query(sql,params)).rows[0])[0]; }
async function source(db) { return scalar(db, `select editorial_start(111,'cabeza','Cabeza','Reconcile sources')`); }
async function save(db, key='researcher-a', version=0, options={}) {
 return scalar(db, `select desk_save_editorial_agent($1,$2,$3,$4,$5,$6,$7,$8)`,
  [key,options.name??'Research agent',options.role??'research',options.model??'local-v1',options.instructions??'Compare source provenance',options.enabled??true,version,`${key}-request-${version}`]);
}
async function claim(db, role='research') { return scalar(db, `select editorial_claim('worker-a',array[$1]::text[],120)`,[role]); }
async function finish(db, task) { return scalar(db, `select editorial_complete($1,$2,'{"candidate":true}','{"nodes":["execute"]}')`,[task.id,task.lease_token]); }

test('unconfigured or incompatible agents cannot consume work or attempts', async()=>{
 const db=await database(); try {
  const s=await source(db);
  assert.equal(await claim(db),null);
  await save(db,'writer-a',0,{role:'writer'});
  await save(db,'researcher-a',0,{enabled:false});
  assert.equal(await claim(db),null);
  assert.equal(await scalar(db,'select attempt from editorial_tasks where id=$1',[s.task_id]),0);
  assert.equal(await scalar(db,'select count(*)::int from editorial_task_agents'),0);
  await save(db,'researcher-a',1);
  const t=await claim(db);
  assert.equal(t.attempt,1);
  assert.deepEqual(t.agent_config,{agent_key:'researcher-a',version:2,name:'Research agent',role:'research',model:'local-v1',instructions:'Compare source provenance'});
  assert.equal(t.sources[0].id,111);
 } finally {await db.close();}
});

test('first eligible configuration is pinned once; later edits and restart preserve its instructions and model',async()=>{
 const db=await database(); try {
  await source(db); await save(db,'researcher-z'); await save(db,'researcher-a');
  const t=await claim(db); assert.equal(t.agent_config.agent_key,'researcher-a');
  await save(db,'researcher-a',1,{model:'local-v2',instructions:'New instructions'});
  await db.exec(`update editorial_tasks set lease_expires_at=clock_timestamp()-interval '1 second' where id=${t.id}`);
  assert.equal(await scalar(db,'select editorial_recover()'),1);
  const retry=await claim(db);
  assert.equal(retry.attempt,2); assert.notEqual(retry.lease_token,t.lease_token);
  assert.deepEqual(retry.agent_config,t.agent_config);
  assert.equal(await scalar(db,'select count(*)::int from editorial_task_agents'),1);
  assert.equal(await scalar(db,"select count(*)::int from editorial_task_events where event='agent-bound'"),1);
  await assert.rejects(finish(db,t),/stale lease/);
  await finish(db,retry);
  await db.exec(migrations[2]);
  assert.equal(await scalar(db,'select count(*)::int from editorial_task_agents'),1);
 } finally {await db.close();}
});

test('pause revokes renewal, completion and new claims; resume keeps the original version',async()=>{
 const db=await database(); try {
  await source(db); await save(db); const t=await claim(db);
  await save(db,'researcher-a',1,{enabled:false});
  assert.equal(await scalar(db,'select editorial_renew($1,$2,120)',[t.id,t.lease_token]),false);
  await assert.rejects(finish(db,t),/agent unavailable/);
  assert.equal(await scalar(db,'select count(*)::int from editorial_results'),0);
  await db.exec(`update editorial_tasks set lease_expires_at=clock_timestamp()-interval '1 second' where id=${t.id}`);
  await scalar(db,'select editorial_recover()');
  await save(db,'researcher-b');
  assert.equal(await claim(db),null,'another agent must not replace a paused bound identity');
  assert.equal(await scalar(db,'select attempt from editorial_tasks where id=$1',[t.id]),1);
  await save(db,'researcher-a',2,{model:'new-model',instructions:'New instructions'});
  const retry=await claim(db); assert.equal(retry.agent_config.version,1);
  assert.equal(retry.agent_config.model,'local-v1');
  const receipt=await finish(db,retry);
  await save(db,'researcher-a',3,{enabled:false});
  const replay=await finish(db,retry);
  assert.equal(replay.replayed,true); assert.equal(replay.result_id,receipt.result_id);
 } finally {await db.close();}
});

test('changing current role revokes prior role authority without repinning an assigned task',async()=>{
 const db=await database(); try {
  const {topic_id}=await source(db); await save(db); const t=await claim(db);
  await save(db,'researcher-a',1,{role:'writer'});
  assert.equal(await scalar(db,'select editorial_renew($1,$2,120)',[t.id,t.lease_token]),false);
  await assert.rejects(finish(db,t),/agent unavailable/);
  await scalar(db,`select editorial_fail($1,$2,'role changed')`,[t.id,t.lease_token]);
  assert.equal(await claim(db),null);
  await scalar(db,`select editorial_enqueue($1,'writer','draft:1','{}')`,[topic_id]);
  const writer=await claim(db,'writer');
  assert.equal(writer.role,'writer'); assert.equal(writer.agent_config.version,2);
  assert.equal(writer.agent_config.agent_key,'researcher-a');
 } finally {await db.close();}
});

test('bindings are immutable even for owner and service role has read/RPC authority only',async()=>{
 const db=await database(); try {
  await source(db); await save(db);
  await db.exec('set role terraveler_service');
  const t=await claim(db); assert.equal(t.agent_config.version,1);
  assert.equal(await scalar(db,'select count(*)::int from editorial_task_agents'),1);
  await assert.rejects(db.exec('update editorial_task_agents set agent_version_id=agent_version_id'),/permission denied/);
  await assert.rejects(db.exec(`select editorial_bound_agent(1,'research')`),/permission denied/);
  await db.exec('reset role');
  await assert.rejects(db.exec('delete from editorial_task_agents'),/append-only/);
  await assert.rejects(db.exec('truncate editorial_task_agents'),/append-only/);
  await assert.rejects(db.exec('update editorial_task_agents set agent_version_id=agent_version_id'),/append-only/);
  await db.exec('set role visitor');
  await assert.rejects(db.exec('select * from editorial_task_agents'),/permission denied/);
  await assert.rejects(claim(db),/permission denied/);
 } finally {await db.close();}
});

test('pre-migration running work cannot complete without a binding and binds only after recovery',async()=>{
 const db=await database(); try {
  const {task_id}=await source(db); await save(db);
  const token=await scalar(db,`update editorial_tasks set state='running',attempt=1,worker='legacy-worker',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds' where id=$1 returning lease_token`,[task_id]);
  assert.equal(await scalar(db,'select editorial_renew($1,$2,120)',[task_id,token]),false);
  await assert.rejects(finish(db,{id:task_id,lease_token:token}),/agent unavailable/);
  await db.exec(`update editorial_tasks set lease_expires_at=clock_timestamp()-interval '1 second' where id=${task_id}`);
  await scalar(db,'select editorial_recover()');
  const t=await claim(db); assert.equal(t.attempt,2); assert.equal(t.agent_config.version,1);
  await finish(db,t);
 } finally {await db.close();}
});
