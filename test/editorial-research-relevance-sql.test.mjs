import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
// The research corpus read used to hand every work item of a dossier the first
// rag_docs of its voyage by id: one book's opening pages, whatever the question.
// PGlite has no pgvector, so these tests cover the unranked (diversity) path and
// the guards around the ranked one; the ranked order itself is checked on the
// canonical database (see the PR description).
const names=['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline','editorial_chat','editorial_specialists','editorial_agent_specialties','editorial_mcp_plans','editorial_preparation','editorial_mcp_corpus','editorial_plan_dispatch','editorial_dossier_sources','editorial_textual_newsroom','editorial_research_relevance'];
const migrations=await Promise.all(names.map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];

async function setup(){
 const db=new PGlite();
 await db.exec(`create role terraveler_service;create role anon;create role authenticated;create role terraveler_editorial_worker;
 create table submissions(id bigint primary key,status text,payload jsonb,target_voyage text);
 create table rag_docs(id bigint primary key,voyage_slug text,type text,title text,content text,source_url text,license text,work_id text,chunk_index integer);
 create table source_endpoints(id bigint primary key,host_pattern text,match_type text,status text,trust_mode text);
 create table source_policy_decisions(id bigint primary key,endpoint_id bigint,decision_outcome text,trust_mode text,rights_class text,timestamp timestamptz);
 alter default privileges in schema public grant all on tables to anon,authenticated,terraveler_editorial_worker;
 alter default privileges in schema public grant execute on functions to anon,authenticated,terraveler_editorial_worker;
 insert into submissions values(79,'approved','{}','magellan-1519');
 insert into source_endpoints values(1,'www.gutenberg.org','exact','active','domain_trusted'),(2,'.wikipedia.org','suffix','active','domain_trusted'),(3,'archive.org','exact','active','item_verified');
 insert into source_policy_decisions values(1,1,'approve','domain_trusted','public_domain',now()),(2,2,'approve','domain_trusted','creative_commons',now()),(3,3,'approve','item_verified','public_domain',now());`);
 // One long book inserted first (the old read saw nothing else), then four
 // encyclopaedia articles, then a work on a host only item-verified.
 const rows=[];let id=1;
 for(let i=0;i<60;i++)rows.push([id++,'Pigafetta — First Voyage','https://www.gutenberg.org/ebooks/42884','Public domain','pigafetta',i]);
 for(const w of ['Elcano','Lapulapu','Mactan','Strait'])for(let i=0;i<5;i++)rows.push([id++,'Wikipedia — '+w,'https://en.wikipedia.org/wiki/'+w,'CC BY-SA 4.0','wiki-'+w,i]);
 for(let i=0;i<5;i++)rows.push([id++,'Archive item','https://archive.org/details/item','Public domain','archive-item',i]);
 for(const [i,title,url,license,work,chunk] of rows)
  await db.query("insert into rag_docs values($1,'magellan-1519','text',$2,$3,$4,$5,$6,$7)",[i,title,`${work} chunk ${chunk}: `+'x'.repeat(700),url,license,work,chunk]);
 for(const sql of migrations)await db.exec(sql);
 await scalar(db,"select editorial_attach(79,'magellan-1519','Magellan','Research')");
 for(const [key,role,specialty] of [['planner','coordinator',null],['reviewer','reviewer','factcheck'],['copyeditor','reviewer','copyedit'],['historian','research','history'],['ethno','research','ethnohistory'],['itin','research','itinerary'],['writer','writer','diary'],['editorialist','writer','editorial']]){
  const v=await scalar(db,'select desk_save_editorial_specialist_agent($1,$1,$2,$3,$4,true,0,$5,$6)',[key,role,'offline','instructions','agent-request-'+key+'-0001',specialty]);assert.ok(!v.error,JSON.stringify(v));
 }
 return db;
}
async function claimResearch(db){
 const wiki='https://en.wikipedia.org/wiki/Magellan';
 const r=await scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',['get_wikipedia_outline',{url:wiki},JSON.stringify({kind:'wikipedia-orientation',purpose:'planning-only',requested_url:wiki,revision_id:1,sections:[{index:'1',title:'Voyage'}],text:'Orientation',text_truncated:false,sections_truncated:false,external_links_truncated:false})]);
 const item=(id,specialty,depends_on,question=id)=>({id,specialty,question,deliverable:'artifact',depends_on,source_receipt_ids:[]});
 const research=[item('hist','history',[],'Who commanded the fleet?'),item('ethno','ethnohistory',[],'Which peoples met the fleet at Cebu?'),item('itin','itinerary',[],'Where did the fleet anchor?')];
 const ids=research.map(x=>x.id);
 const writing=w=>[item(w,w,ids),item(w+'-copyedit','copyedit',[w]),item(w+'-factcheck','factcheck',[w])];
 const plan={orientation_receipt_id:r.id,gaps:[],work_items:[...research,...writing('diary'),...writing('editorial')]};
 const p=await scalar(db,'select editorial_record_preparation($1,$2,$3,$4,$5,$6,$7,$8,$9)',[1,0,'prepared-request-00001',null,wiki,plan,1,2,{verdict:'adequate-for-next-stage',issues:[]}]);
 await db.exec('set role terraveler_service');
 await scalar(db,'select editorial_dispatch_plan(1,$1,$2)',[p.plan_id,'relevance-dispatch-0001']);
 return scalar(db,"select editorial_claim('worker',array['research'],120)");
}

test('an unranked read spreads across works instead of one book\'s first pages',async()=>{const db=await setup();try{
 const task=await claimResearch(db);assert.ok(task?.id,'research task claimed');
 const r=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[task.id,task.attempt,'worker']);
 assert.equal(r.retrieval.mode,'diversity');
 const works=r.sources.map(s=>s.url);
 const perWork=works.reduce((m,u)=>(m[u]=(m[u]??0)+1,m),{});
 assert.ok(Object.keys(perWork).length>=5,`a mix of works, got ${JSON.stringify(perWork)}`);
 assert.ok(Object.values(perWork).every(n=>n<=3),'no work beyond three chunks');
 const perHost=works.reduce((m,u)=>{const h=new URL(u).host;m[h]=(m[h]??0)+1;return m},{});
 assert.ok(Object.values(perHost).every(n=>n<=10),`no host beyond ten chunks, got ${JSON.stringify(perHost)}`);
 assert.ok(!works.some(u=>u.includes('archive.org')),'item-verified hosts stay out until verified per item');
 assert.ok(r.sources.length>=10,'the budget carries more than the old ~9 chunks');
 assert.ok(Buffer.byteLength(JSON.stringify(r.sources))<=24000,'fits the worker\'s cap');
 await db.exec('reset role');
 const why=await scalar(db,'select retrieval from editorial_corpus_consultations where task_id=$1',[task.id]);
 assert.equal(why.mode,'diversity');assert.equal(why.per_work_cap,3);assert.equal(why.per_host_cap,10);
 assert.equal(why.picks.length,r.sources.length);assert.equal(why.works,Object.keys(perWork).length);
 assert.match(why.question,/\?$/);
 }finally{await db.close();}});

test('a malformed or foreign query embedding is refused before any read',async()=>{const db=await setup();try{
 const task=await claimResearch(db);
 for(const bad of ['not a vector','[1,2,3]; drop table rag_docs','['+Array(768).fill('0.1').join(',')+']']){
  await assert.rejects(scalar(db,'select editorial_read_mcp_corpus($1,$2,$3,$4)',[task.id,task.attempt,'worker',bad]),/invalid query embedding/);
 }
 await db.exec('reset role');
 assert.equal(await scalar(db,'select count(*)::int from editorial_corpus_consultations'),0);
 }finally{await db.close();}});

test('only the trusted data service may read; the old three-argument form is gone',async()=>{const db=await setup();try{
 assert.equal(await scalar(db,"select count(*)::int from pg_proc where proname='editorial_read_mcp_corpus'"),1);
 for(const role of ['anon','authenticated','terraveler_editorial_worker']){
  await db.exec(`set role ${role}`);
  await assert.rejects(scalar(db,'select editorial_read_mcp_corpus(1,1,$1)',['worker']),/permission denied/);
  await db.exec('reset role');
 }
 }finally{await db.close();}});
