import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const names=['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline','editorial_chat','editorial_specialists','editorial_agent_specialties','editorial_mcp_plans','editorial_preparation','editorial_mcp_corpus','editorial_plan_dispatch','editorial_dossier_sources'];
const migrations=await Promise.all(names.map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const url='https://example.org/journal';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role terraveler_service;create role anon;create role authenticated;create role terraveler_editorial_worker;
 create table submissions(id bigint primary key,status text,payload jsonb,target_voyage text);
 create table rag_docs(id bigint primary key,voyage_slug text,type text,title text,content text,source_url text,license text);
 create table source_endpoints(id bigint primary key,host_pattern text,match_type text,status text,trust_mode text);
 create table source_policy_decisions(id bigint primary key,endpoint_id bigint,decision_outcome text,trust_mode text,rights_class text,timestamp timestamptz);
 alter default privileges in schema public grant all on tables to anon,authenticated,terraveler_editorial_worker;
 alter default privileges in schema public grant execute on functions to anon,authenticated,terraveler_editorial_worker;
 insert into submissions values(111,'approved','{}',null);
 insert into source_endpoints values(1,'example.org','exact','active','domain_trusted');
 insert into source_policy_decisions values(1,1,'approve','domain_trusted','public_domain',now());`);
 for(const sql of migrations)await db.exec(sql);
 await scalar(db,"select editorial_attach(111,'cabeza-new','Cabeza de Vaca','Research')");
 return db;
}
async function record(db,patch={},tool='fetch_source_text'){
 const body={url,kind:'gutenberg',lang:null,text:'They departed.',truncated:false,total_length:14,...patch};
 const args={url:body.url,kind:body.kind,lang:null};
 return scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',[tool,args,JSON.stringify(body)]);
}
const attach=(db,id,request='dossier-source-request-01',title='Journal',topic=1)=>scalar(db,'select editorial_attach_source($1,$2,$3,$4)',[topic,id,title,request]);
async function prepared(db){
 for(const [key,role,specialty] of [['planner','coordinator',null],['reviewer','reviewer','factcheck'],['historian','research','history'],['writer','writer','diary']]){
  const v=await scalar(db,'select desk_save_editorial_specialist_agent($1,$1,$2,$3,$4,true,0,$5,$6)',[key,role,'offline','instructions','agent-request-'+key+'-0001',specialty]);assert.ok(!v.error);
 }
 const wiki='https://en.wikipedia.org/wiki/Example';
 const r=await scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',['get_wikipedia_outline',{url:wiki},JSON.stringify({kind:'wikipedia-orientation',purpose:'planning-only',requested_url:wiki,revision_id:123,sections:[{index:'1',title:'History'}],text:'Orientation',text_truncated:false,sections_truncated:false,external_links_truncated:false})]);
 const item=(id,specialty,depends_on)=>({id,specialty,question:id,deliverable:'artifact',depends_on,source_receipt_ids:[]});
 return scalar(db,'select editorial_record_preparation($1,$2,$3,$4,$5,$6,$7,$8,$9)',[1,0,'prepared-request-00001',null,wiki,{orientation_receipt_id:r.id,gaps:[],work_items:[item('history','history',[]),item('diary','diary',['history']),item('check','factcheck',['diary'])]},1,2,{verdict:'adequate-for-next-stage',issues:[]}]);
}
const python=String.raw`import io,json,sys
from orchestration.editorial_handlers import research,writer,reviewer
from orchestration.editorial_mcp_corpus import retrieve_mcp_sources
from orchestration.editorial_gateway import GatewayConfig
v=json.load(sys.stdin); t=v['task']; config=GatewayConfig('http://offline-limen:8080','fixture','editorial')
def generate(task,cfg):
    if task['role']=='research':
        sid=task['input']['retrieved_sources'][0]['id']
        return {'candidate':{'findings':[{'text':'They departed.','source_ids':[sid],'quotes':[]}],'uncertainties':[]}}
    if task['role']=='writer':
        sid=task['input']['research_result']['references'][0]['id']
        return {'candidate':{'title':'A private journey','body':'They departed.','citations':[{'source_id':sid,'claim':'They departed.'}]}}
    return {'candidate':{'verdict':'ready-for-editor','issues':[]}}
def retrieve(task):
    def transport(req,timeout):
        body={'jsonrpc':'2.0','id':1,'result':{'structuredContent':v['receipt']}}
        return io.BytesIO(json.dumps(body).encode())
    return retrieve_mcp_sources(task,env={'EDITORIAL_MCP_URL':'https://fixture.invalid/api/mcp','EDITORIAL_MCP_CORPUS_KEY':'x'*40},open_request=transport)
if t['role']=='research':r=research(t,config,retrieve=retrieve,generator=generate)
elif t['role']=='writer':r=writer(t,config,generator=generate)
else:r=reviewer(t,config,generator=generate)
json.dump(r,sys.stdout)
`;
function handler(task,receipt=null){const r=spawnSync('python3',['-c',python],{cwd:root,input:JSON.stringify({task,receipt}),encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}

test('new dossier without target_voyage uses MCP receipts through all existing private draft stages',async()=>{const db=await setup();try{
 const p=await prepared(db);
 await assert.rejects(scalar(db,'select editorial_dispatch_plan(1,$1,$2)',[p.plan_id,'before-source-dispatch1']),/governed dossier sources required/);
 const c=await record(db);const linked=await attach(db,c.id);
 assert.equal((await attach(db,c.id)).replayed,true);
 assert.equal((await attach(db,c.id,'another-source-request1')).id,linked.id);
 await assert.rejects(attach(db,c.id,'another-source-request1','Changed label'),/idempotency conflict/);
 assert.equal(await scalar(db,'select count(*)::int from rag_docs'),0);
 assert.equal(await scalar(db,'select count(*)::int from editorial_tasks'),0);
 await db.exec('set role terraveler_service');
 const run=await scalar(db,'select editorial_dispatch_plan(1,$1,$2)',[p.plan_id,'dossier-dispatch-request1']);
 const research=await scalar(db,"select editorial_claim('worker',array['research'],120)");
 const receipt=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[research.id,research.attempt,'worker']);
 assert.equal(receipt.sources[0].id,'mcp:'+c.id);
 assert.equal(receipt.sources[0].governance.source_receipt_id,c.id);
 const result=handler(research,receipt);
 const tampered=structuredClone(result);tampered.references[0].text='Invented source body';
 await assert.rejects(scalar(db,'select editorial_complete($1,$2,$3,$4)',[research.id,research.lease_token,tampered,{}]),/invalid or revoked MCP receipt/);
 await scalar(db,'select editorial_complete($1,$2,$3,$4)',[research.id,research.lease_token,result,{}]);
 const writer=await scalar(db,"select editorial_claim('worker',array['writer'],120)");
 await scalar(db,'select editorial_complete($1,$2,$3,$4)',[writer.id,writer.lease_token,handler(writer),{}]);
 const reviewer=await scalar(db,"select editorial_claim('worker',array['reviewer'],120)");
 await scalar(db,'select editorial_complete($1,$2,$3,$4)',[reviewer.id,reviewer.lease_token,handler(reviewer),{}]);
 assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'awaiting-editor');
 await db.exec('reset role');assert.equal(await scalar(db,'select count(*)::int from submissions'),1);
 assert.equal(await scalar(db,'select count(*)::int from rag_docs'),0);
 await db.exec(migrations.at(-1));assert.equal(await scalar(db,'select count(*)::int from editorial_topic_sources'),1);
 }finally{await db.close();}});

test('complete source receipts, current rights and exact endpoints are required before association',async()=>{const db=await setup();try{
 const truncated=await record(db,{truncated:true});await assert.rejects(attach(db,truncated.id),/complete governed MCP source receipt/);
 await assert.rejects(attach(db,'00000000-0000-4000-8000-000000000001'),/complete governed MCP source receipt/);
 const c=await record(db);
 await db.exec("insert into source_policy_decisions values(2,1,'approve','item_verified','public_domain',now()+interval '1 second')");
 await assert.rejects(attach(db,c.id),/complete governed MCP source receipt/);
 await db.exec("delete from source_policy_decisions where id=2; update source_endpoints set status='quarantined' where id=1");
 await assert.rejects(attach(db,c.id),/complete governed MCP source receipt/);
 await db.exec("update source_endpoints set status='active' where id=1");await attach(db,c.id);
 assert.equal(await scalar(db,'select jsonb_array_length(editorial_topic_receipt_sources(1))'),1);
 await db.exec("insert into source_policy_decisions values(2,1,'reject',null,'unknown',now()+interval '1 second')");
 assert.equal(await scalar(db,'select jsonb_array_length(editorial_topic_receipt_sources(1))'),0);
 // A trusted parent suffix cannot shadow an exact revoked endpoint.
 await db.exec("insert into source_endpoints values(2,'.example.org','suffix','active','domain_trusted');insert into source_policy_decisions values(3,2,'approve','domain_trusted','public_domain',now())");
 assert.equal(await scalar(db,'select jsonb_array_length(editorial_topic_receipt_sources(1))'),0);
 }finally{await db.close();}});

test('dossier sources cannot be written or read by contributors/workers; history is immutable',async()=>{const db=await setup();try{
 const c=await record(db);await attach(db,c.id);
 for(const role of ['anon','authenticated','terraveler_editorial_worker']){
  await db.exec(`set role ${role}`);await assert.rejects(attach(db,c.id),/permission denied/);
  await assert.rejects(db.exec('select * from editorial_topic_sources'),/permission denied/);
  await assert.rejects(scalar(db,'select editorial_topic_receipt_sources(1)'),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role terraveler_service');await assert.rejects(db.exec('delete from editorial_topic_sources'),/permission denied/);await db.exec('reset role');
 for(const q of ['update editorial_topic_sources set title=title','delete from editorial_topic_source_requests','truncate editorial_topic_sources cascade'])await assert.rejects(db.exec(q),/append-only/);
 }finally{await db.close();}});
