import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const [workflow,migration]=await Promise.all(['editorial_workflow','editorial_project_bridge'].map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
async function setup(){const db=new PGlite();await db.exec(`
 create role terraveler_service;create role anon;create role authenticated;create role terraveler_editorial_worker;
 create table contributors(id bigint primary key);
 insert into contributors values(1);
 create table submissions(id bigint primary key,type text,status text,payload jsonb,contributor_id bigint references contributors(id));
 create table editorial_gaps(id bigint generated always as identity primary key,title text,description text,kind text,priority int,status text,initiated_by_contributor_id bigint);
 alter default privileges in schema public grant all on tables to anon,authenticated,terraveler_editorial_worker;
 alter default privileges in schema public grant execute on functions to anon,authenticated,terraveler_editorial_worker;
`);await db.exec(workflow);await db.exec(migration);await db.exec(`
 insert into editorial_topics(topic_key,title,objective) values('voyage','Private dossier title','PRIVATE objective'),('other','Other','Other');
 insert into submissions values(111,'idea','approved','{"title":"Public voyage","description":"PRIVATE large body"}',1),(112,'idea','approved','{"title":"More evidence"}',1),(113,'idea','rejected','{"title":"Refused"}',1),(114,'new-voyage','approved','{"title":"Draft"}',1),(115,'idea','approved','{"title":"Unattached"}',1),(116,'idea','approved','{"title":"Other"}',1);
 insert into editorial_topic_submissions(submission_id,topic_id,snapshot) select id,case when id=116 then 2 else 1 end,to_jsonb(s) from submissions s where id<>115;
`);return db;}
const reconcile=(db,topic=1,submission=111,key='bridge-request-0001',gap=null)=>scalar(db,'select editorial_reconcile_project($1,$2,$3,$4)',[topic,submission,key,gap]);

test('explicit reconciliation reuses one public work item for a canonical dossier and exact retries',async()=>{const db=await setup();try{
 assert.equal(await scalar(db,'select count(*)::int from editorial_gaps'),0,'migration never backfills approved ideas');
 await db.exec('set role terraveler_service');const first=await reconcile(db);assert.equal(first.created,true);assert.equal(first.replayed,false);
 const replay=await reconcile(db);assert.equal(replay.gap_id,first.gap_id);assert.equal(replay.replayed,true);
 const additional=await reconcile(db,1,112,'bridge-request-0002');assert.equal(additional.gap_id,first.gap_id);assert.equal(additional.created,false);
 await assert.rejects(reconcile(db,1,112,'bridge-request-0001'),/idempotency conflict/);
 await db.exec('reset role');
 const g=(await db.query('select * from editorial_gaps')).rows[0];assert.equal(g.title,'Public voyage');assert.doesNotMatch(g.description,/PRIVATE/);
 assert.match(g.description,/candidates/);assert.equal(g.source_submission_id,111);
 assert.equal(await scalar(db,'select count(*)::int from editorial_project_bridges'),1);
 assert.equal(await scalar(db,'select count(*)::int from editorial_tasks'),0);
 assert.equal(await scalar(db,'select count(*)::int from editorial_results'),0);
 await db.exec(migration);assert.equal(await scalar(db,'select count(*)::int from editorial_gaps'),1);
 }finally{await db.close();}});

test('bridge rejects unapproved, non-idea, unattached and conflicting work',async()=>{const db=await setup();try{
 for(const [topic,id,key] of [[1,113,'rejected-request-0001'],[1,114,'draft-request-00001'],[1,115,'unattached-request-01'],[2,111,'wrong-topic-request1']]) await assert.rejects(reconcile(db,topic,id,key));
 const first=await reconcile(db);await db.exec("insert into editorial_gaps(title,status) values('Existing public work','open')");
 const otherGap=await scalar(db,'select max(id) from editorial_gaps');
 await assert.rejects(reconcile(db,1,111,'conflict-request-001',otherGap),/another public work item/);
 await assert.rejects(reconcile(db,2,116,'conflict-request-002',first.gap_id),/another topic/);
 assert.equal(await scalar(db,'select count(*)::int from editorial_project_bridges'),1);
 }finally{await db.close();}});

test('legacy work is reused only by explicit identifiers; existing claim state is preserved',async()=>{const db=await setup();try{
 await db.exec("insert into editorial_gaps(title,description,kind,status,source_submission_id) values('Same title','Public existing brief','voyage','claimed',111)");
 const legacy=await scalar(db,'select id from editorial_gaps');const linked=await reconcile(db);
 assert.equal(linked.gap_id,legacy);assert.equal(linked.created,false);
 assert.equal(await scalar(db,'select status from editorial_gaps where id=$1',[legacy]),'claimed');
 await db.exec("insert into editorial_gaps(title,kind,status) values('Explicit old waypoint','waypoint','done')");
 const another=await scalar(db,'select max(id) from editorial_gaps');const explicit=await reconcile(db,2,116,'explicit-request-0001',another);
 assert.equal(explicit.gap_id,another);assert.equal(await scalar(db,'select source_submission_id from editorial_gaps where id=$1',[another]),116);
 }finally{await db.close();}});

test('public/contributor/worker roles cannot link projects or rewrite immutable bridge history',async()=>{const db=await setup();try{
 for(const role of ['anon','authenticated','terraveler_editorial_worker']){
  await db.exec(`set role ${role}`);await assert.rejects(reconcile(db),/permission denied/);
  await assert.rejects(db.exec('select * from editorial_project_bridge_requests'),/permission denied/);
  await assert.rejects(db.exec('select * from editorial_project_bridges'),/permission denied/);await db.exec('reset role');
 }
 await reconcile(db);await db.exec('set role terraveler_service');
 await assert.rejects(db.exec('delete from editorial_project_bridges'),/permission denied/);await db.exec('reset role');
 for(const sql of ['update editorial_project_bridges set topic_id=topic_id','delete from editorial_project_bridge_requests','truncate editorial_project_bridges cascade']) await assert.rejects(db.exec(sql),/append-only/);
 }finally{await db.close();}});
