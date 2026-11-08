import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration=await readFile(new URL('../supabase/editorial_team.sql',import.meta.url),'utf8');
async function database(){
 const db=new PGlite();
 await db.exec('create role terraveler_service; create role visitor;');
 await db.exec(migration);
 return db;
}
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
const base={agent_key:'historical-researcher',name:'Historical researcher',role:'research',model:'local-default',
 instructions:'Read the approved primary sources. Distinguish uncertainty from evidence.',enabled:false,expected_version:0,request_id:'request-first-0001'};
async function save(db,change={}){
 const p={...base,...change};
 return scalar(db,'select desk_save_editorial_agent($1,$2,$3,$4,$5,$6,$7,$8)',
  [p.agent_key,p.name,p.role,p.model,p.instructions,p.enabled,p.expected_version,p.request_id]);
}

test('configuration is versioned and retries reuse the original result after later edits',async()=>{
 const db=await database();try{
  assert.deepEqual(await save(db),{agent_key:base.agent_key,version:1,replayed:false});
  const next={name:'Source researcher',instructions:'Compare sources and prepare candidate findings.',enabled:true,expected_version:1,request_id:'request-second-0002'};
  assert.equal((await save(db,next)).version,2);
  assert.deepEqual(await save(db),{agent_key:base.agent_key,version:1,replayed:true});
  const rows=(await db.query('select version,instructions,enabled from editorial_agent_versions order by version')).rows;
  assert.equal(rows.length,2);assert.equal(rows[0].instructions,base.instructions);assert.equal(rows[0].enabled,false);
  assert.equal(await scalar(db,'select version from editorial_agents_current'),2);
  assert.equal(await scalar(db,'select name from editorial_agents_current'),next.name);
  await db.exec(migration);
  assert.equal(await scalar(db,'select count(*)::int from editorial_agent_versions'),2);
 }finally{await db.close();}
});

test('stale editors cannot overwrite a configuration and reused request keys cannot change intent',async()=>{
 const db=await database();try{
  await save(db);
  assert.deepEqual(await save(db,{request_id:'request-stale-0003',name:'Stale edit'}),{error:'conflict',current_version:1});
  assert.deepEqual(await save(db,{enabled:true}),{error:'idempotency-conflict'});
  assert.deepEqual(await save(db,{agent_key:'another-agent'}),{error:'idempotency-conflict'});
  assert.equal(await scalar(db,'select count(*)::int from editorial_agent_versions'),1);
 }finally{await db.close();}
});

test('input bounds reject unsupported roles, invalid identities, nullable state and oversized instructions',async()=>{
 const db=await database();try{
  for(const change of [{role:'publisher'},{agent_key:'../escape'},{name:' '},{instructions:'x'.repeat(12001)},
   {enabled:null},{expected_version:-1},{expected_version:null},{model:'model\ninjected'},{request_id:'short'}]){
   assert.deepEqual(await save(db,change),{error:'invalid-agent'});
  }
  assert.equal(await scalar(db,'select count(*)::int from editorial_agent_versions'),0);
 }finally{await db.close();}
});

test('history rejects owner mutation and visitors cannot read or invoke editor writes',async()=>{
 const db=await database();try{
  await save(db);
  for(const sql of ['update editorial_agent_versions set enabled=true','delete from editorial_agent_versions','truncate editorial_agent_versions']){
   await assert.rejects(db.exec(sql),/append-only/);
  }
  await db.exec('set role terraveler_service');
  assert.equal(await scalar(db,'select count(*)::int from editorial_agents_current'),1);
  await assert.rejects(db.exec('update editorial_agent_versions set enabled=true'),/permission denied/);
  assert.equal((await save(db,{expected_version:1,enabled:true,request_id:'request-service-0004'})).version,2);
  await db.exec('reset role; set role visitor');
  await assert.rejects(db.exec('select * from editorial_agents_current'),/permission denied/);
  await assert.rejects(save(db),/permission denied/);
 }finally{await db.close();}
});
