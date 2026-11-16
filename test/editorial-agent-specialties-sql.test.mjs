import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migrations=await Promise.all(['editorial_workflow','editorial_team','editorial_agent_binding','editorial_specialists','editorial_agent_specialties'].map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
async function scalar(db,q,args=[]){return Object.values((await db.query(q,args)).rows[0])[0];}
async function setup(){const db=new PGlite();await db.exec(`create role terraveler_service;create role visitor;create table submissions(id bigint primary key,status text,payload jsonb);insert into submissions values(111,'approved','{}');`);for(const sql of migrations)await db.exec(sql);return db;}
async function save(db,{key='specialist-a',specialty='history',version=0,enabled=true,role='research',request=`specialist-save-${version}-0001`}={}){return scalar(db,'select desk_save_editorial_specialist_agent($1,$1,$2,$3,$4,$5,$6,$7,$8)',[key,role,'local-model','Evidence only',enabled,version,request,specialty]);}

test('specialty is immutable per exact version, optimistic and request-idempotent',async()=>{const db=await setup();try{
 const first=await save(db);assert.equal(first.specialty,'history');assert.equal((await save(db)).replayed,true);
 assert.equal((await save(db,{specialty:'ethnohistory',enabled:false})).error,'idempotency-conflict');
 assert.equal((await save(db,{specialty:'diary',role:'writer',request:'other-save-request-0001'})).error,'conflict');
 const second=await save(db,{version:1,enabled:false,specialty:'ethnohistory'});assert.equal(second.version,2);
 const rows=(await db.query('select a.version,s.specialty from editorial_agent_versions a join editorial_agent_specialties s on s.agent_version_id=a.id order by a.version')).rows;
 assert.deepEqual(rows,[{version:1,specialty:'history'},{version:2,specialty:'ethnohistory'}]);
 await assert.rejects(db.exec("update editorial_agent_specialties set specialty='history'"),/append-only/);
 await db.exec(migrations[4]);assert.equal(await scalar(db,'select count(*)::int from editorial_agent_specialties'),2);
 }finally{await db.close();}});

test('planned specialties cannot enable or bypass via null edits; old configs remain supported',async()=>{const db=await setup();try{
 assert.equal((await save(db,{specialty:'ethnohistory'})).error,'specialist-handler-not-implemented');
 assert.equal((await save(db,{specialty:'diary'})).error,'specialty-role-mismatch');
 assert.equal(await scalar(db,'select count(*)::int from editorial_agent_versions'),0);
 await save(db,{specialty:'ethnohistory',enabled:false});
 assert.equal((await save(db,{version:1,specialty:null})).error,'specialist-handler-not-implemented');
 await save(db,{version:1,specialty:null,enabled:false});
 assert.equal((await save(db,{version:1,specialty:null,enabled:false})).replayed,true);
 assert.equal(await scalar(db,"select specialty from editorial_specialist_agents_current where agent_key='specialist-a'"),'ethnohistory');
 assert.equal((await save(db,{key:'legacy-agent',specialty:null,request:'legacy-save-request-0001'})).specialty,null);
 }finally{await db.close();}});

test('assignment and lease authority follow current specialty without switching frozen configuration',async()=>{const db=await setup();try{
 const source=await scalar(db,"select editorial_start(111,'cabeza','Cabeza','Source research')");
 await save(db);
 await scalar(db,"select editorial_assign_specialist($1,'specialist-a','history','assign-specialist-0001')",[source.task_id]);
 await save(db,{version:1,specialty:'ethnohistory',enabled:false});
 assert.equal(await scalar(db,"select editorial_claim('worker',array['research'],120)"),null);
 assert.equal(await scalar(db,'select count(*)::int from editorial_task_agents'),0);
 await save(db,{version:2,specialty:'history'});
 const claimed=await scalar(db,"select editorial_claim('worker',array['research'],120)");assert.equal(claimed.agent_config.version,3);
 await save(db,{version:3,specialty:'ethnohistory',enabled:false});
 assert.equal(await scalar(db,'select editorial_renew($1,$2,120)',[claimed.id,claimed.lease_token]),false);
 await assert.rejects(scalar(db,"select editorial_complete($1,$2,'{}','{}')",[claimed.id,claimed.lease_token]),/agent unavailable/);
 await save(db,{version:4,specialty:'history'}); // resume preserves the frozen task configuration
 assert.equal(await scalar(db,'select editorial_renew($1,$2,120)',[claimed.id,claimed.lease_token]),true);
 }finally{await db.close();}});

test('service reads specialty view and uses save RPC; visitors and direct mutations fail',async()=>{const db=await setup();try{
 await db.exec('set role terraveler_service');await save(db);
 await assert.rejects(scalar(db,"select desk_save_editorial_agent('specialist-a','Research','research','different-model','Evidence',true,1,'legacy-edit-request-0001')"),/permission denied/);
 assert.equal(await scalar(db,'select specialty from editorial_specialist_agents_current'),'history');
 await assert.rejects(db.exec("insert into editorial_agent_specialties values(999,null,'history')"),/permission denied/);
 await db.exec('reset role;set role visitor');await assert.rejects(db.exec('select * from editorial_specialist_agents_current'),/permission denied/);
 await assert.rejects(save(db),/permission denied/);
 }finally{await db.close();}});
