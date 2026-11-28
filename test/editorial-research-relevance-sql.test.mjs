import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
// The research corpus read used to hand every work item of a dossier the first
// rag_docs of its voyage by id: one book's opening pages, whatever the question.
// PGlite has no pgvector, so these tests cover the unranked (diversity) path and
// the guards around the ranked one; the ranked order itself is checked on the
// canonical database (see the PR description).
const names=['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline','editorial_chat','editorial_specialists','editorial_agent_specialties','editorial_mcp_plans','editorial_preparation','editorial_mcp_corpus','editorial_plan_dispatch','editorial_dossier_sources','editorial_textual_newsroom','editorial_task_retry','editorial_graph_revisions','editorial_waypoints','editorial_commons_images','editorial_iconography','editorial_image_text_editor','editorial_research_relevance','editorial_writer_context_bounds'];
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

// Three research items each read their own slice; the writer receives their
// references joined. Carrying every read forward overran the writer's bounded
// context (40 references / 40,000 octets) and the writer could never be claimed.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const python=String.raw`import io,json,sys
from orchestration.editorial_handlers import research
from orchestration.editorial_mcp_corpus import retrieve_mcp_sources
from orchestration.editorial_gateway import GatewayConfig
v=json.load(sys.stdin); t=v['task']; config=GatewayConfig('http://offline-limen:8080','fixture','editorial')
def generate(task,cfg):
    ids=[s['id'] for s in task['input']['retrieved_sources']]
    c={'findings':[{'text':'A finding.','source_ids':ids[:2],'quotes':[]},{'text':'Another.','source_ids':ids[2:3],'quotes':[]}],'uncertainties':[]}
    if v.get('cite_all'):
        c['findings']=[{'text':('Finding %d. ' % n)+'A paragraph of ordinary research prose about the voyage and its sources. '*12,'source_ids':[sid],'quotes':[]} for n,sid in enumerate(ids)]
    if task['input']['work_item']['specialty']=='itinerary':
        c['waypoints']=[{'id':'cebu','sequence':1,'place_historical':'Cebu','place_modern':None,'latitude':10.3,'longitude':123.9,
          'arrival_date':'1521-04','departure_date':None,'date_note':None,'coordinate_note':None,'uncertainty':'Approximate.',
          'event':'The fleet anchored.','source_ids':[ids[3]],'confidence':'approximate'}]
    return {'candidate':c}
def retrieve(task):
    def transport(req,timeout):
        return io.BytesIO(json.dumps({'jsonrpc':'2.0','id':1,'result':{'structuredContent':v['receipt']}}).encode())
    return retrieve_mcp_sources(task,env={'EDITORIAL_MCP_URL':'https://fixture.invalid/api/mcp','EDITORIAL_MCP_CORPUS_KEY':'x'*40},open_request=transport)
json.dump(research(t,config,retrieve=retrieve,generator=generate),sys.stdout)
`;
function handler(task,receipt,cite_all=false){const r=spawnSync('python3',['-c',python],{cwd:root,input:JSON.stringify({task,receipt,cite_all}),encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}

test('three full reads still leave the writer claimable: results carry only cited references',async()=>{const db=await setup();try{
 let task=await claimResearch(db);
 for(let n=0;n<3;n++){
  if(n)task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
  const receipt=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[task.id,task.attempt,'worker']);
  assert.ok(receipt.sources.length>=10);
  const result=handler(task,receipt);
  const cited=task.input.work_item.specialty==='itinerary'?4:3;
  assert.equal(result.references.length,cited,'only cited references (findings and waypoints) travel on');
  await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,result,{}]);
 }
 const writer=await scalar(db,"select editorial_claim('worker',array['writer'],120)");
 assert.ok(writer?.id,'the writer is claimable');
 assert.ok(writer.input.research_result.references.length<=10);
 }finally{await db.close();}});

test('research that cites everything it read still leaves the writer claimable (Magellan, run 23)',async()=>{const db=await setup();try{
 let task=await claimResearch(db);let refs=0;
 for(let n=0;n<3;n++){
  if(n)task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
  const receipt=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[task.id,task.attempt,'worker']);
  const result=handler(task,receipt,true);refs+=result.references.length;
  await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,result,{}]);
 }
 assert.ok(refs>=36,`three full reads, all cited (${refs} references)`);
 const writer=await scalar(db,"select editorial_claim('worker',array['writer'],120)");
 assert.ok(writer?.id,'the writer is claimable');
 assert.ok(Buffer.byteLength(JSON.stringify(writer.input.research_result))>40000,'beyond the old 40,000-octet bound');
 }finally{await db.close();}});
