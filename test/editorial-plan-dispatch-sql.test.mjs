import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const python=String.raw`import io,json,sys
from orchestration.editorial_handlers import research,writer,reviewer
from orchestration.editorial_mcp_corpus import retrieve_mcp_sources
from orchestration.editorial_gateway import GatewayConfig
request=json.load(sys.stdin)
task=request["task"]
conf=GatewayConfig("http://offline-limen:8080","fixture-key","editorial")
def retrieve(task):
    receipt=request["receipt"]
    response={"jsonrpc":"2.0","id":1,"result":{"structuredContent":receipt}}
    def opener(req,timeout):
        assert json.loads(req.data)["params"]["arguments"]=={"task_id":task["id"],"attempt":task["attempt"]}
        return io.BytesIO(json.dumps(response).encode())
    return retrieve_mcp_sources(task,env={"EDITORIAL_MCP_URL":"https://fixture.invalid/api/mcp","EDITORIAL_MCP_CORPUS_KEY":"x"*40},open_request=opener)
def generate(task,cfg):
    if task["role"]=="research":
        assert task["input"]["work_item"]["specialty"]=="history"
        candidate={"kind":"research","findings":[{"text":"Departure","source_ids":["rag:1"],"quotes":[]}],"uncertainties":[]}
    elif task["role"]=="writer":
        assert len(task["input"]["research_result"]["findings"])==2
        candidate={"kind":"draft","title":"Example","body":"They departed.","citations":[{"claim":"They departed.","source_id":"rag:1"}]}
    else:
        assert task["input"]["draft_result"]["title"]=="Example"
        candidate={"kind":"review","verdict":"ready-for-editor","issues":[]}
    return {"candidate":candidate,"verification":"not-verified"}
if task["role"]=="research": result=research(task,conf,retrieve=retrieve,generator=generate)
elif task["role"]=="writer": result=writer(task,conf,generator=generate)
else: result=reviewer(task,conf,generator=generate)
json.dump(result,sys.stdout)
`;
function executeHandler(task,receipt=null){const child=spawnSync('python3',['-c',python],{cwd:root,env:{...process.env,PYTHONPATH:root},input:JSON.stringify({task,receipt}),encoding:'utf8',timeout:10000,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr||child.error?.message);return JSON.parse(child.stdout);}
const names=['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline','editorial_chat','editorial_specialists','editorial_agent_specialties','editorial_mcp_plans','editorial_preparation','editorial_mcp_corpus','editorial_plan_dispatch'];
const migration=await Promise.all(names.map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
test('reviewed plan schedules all dependencies, blocks legacy bypass, requires real MCP receipt, and ends at private draft review',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role terraveler_service;create role visitor;create role terraveler_editorial_worker;
 create table submissions(id bigint primary key,status text,payload jsonb,target_voyage text);
 create table rag_docs(id bigint primary key,voyage_slug text,type text,title text,content text,source_url text,license text);
 create table source_endpoints(id bigint primary key,host_pattern text,match_type text,status text,trust_mode text);
 create table source_policy_decisions(id bigint primary key,endpoint_id bigint,decision_outcome text,trust_mode text,rights_class text,timestamp timestamptz);
 insert into submissions values(1,'approved','{}','example');
 insert into rag_docs values(1,'example','text','Journal','They departed.','https://example.org/journal','Public domain');
 insert into source_endpoints values(1,'example.org','exact','active','domain_trusted');
 insert into source_policy_decisions values(1,1,'approve','domain_trusted','public_domain',now());`);
 for(const sql of migration)await db.exec(sql);
 const topic=await scalar(db,"select editorial_attach(1,'example','Example','Research')");
 assert.equal(topic.topic_id,1);
 for(const [key,role,specialty] of [['planner','coordinator',null],['reviewer','reviewer','factcheck'],['historian','research','history'],['writer','writer','diary']]){
  const v=await scalar(db,'select desk_save_editorial_specialist_agent($1,$1,$2,$3,$4,true,0,$5,$6)',[key,role,'offline','instructions','agent-request-'+key+'-0001',specialty]);assert.ok(!v.error);
 }
 const url='https://en.wikipedia.org/wiki/Example';
 const rec=await scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',['get_wikipedia_outline',{url},JSON.stringify({kind:'wikipedia-orientation',purpose:'planning-only',requested_url:url,revision_id:123,sections:[{index:'1',title:'History'}],text:'Orientation',text_truncated:false,sections_truncated:false,external_links_truncated:false})]);
 const item=(id,specialty,depends_on)=>({id,specialty,question:id,deliverable:'artifact',depends_on,source_receipt_ids:[]});
 const p={orientation_receipt_id:rec.id,gaps:[],work_items:[item('history-a','history',[]),item('history-b','history',[]),item('diary','diary',['history-a','history-b']),item('check','factcheck',['diary'])]};
 const prep=await scalar(db,'select editorial_record_preparation($1,$2,$3,$4,$5,$6,$7,$8,$9)',[1,0,'prepared-request-00001',null,url,p,1,2,{verdict:'adequate-for-next-stage',issues:[]}]);
 // A gate cannot silently ignore legacy unfinished work.
 const legacy=await scalar(db,"select editorial_enqueue(1,'research','legacy','{}',null)");
 await assert.rejects(scalar(db,'select editorial_enable_plan_gate()'),/resolve active legacy work/);
 await db.query("update editorial_tasks set state='attention' where id=$1",[legacy.id]);
 await scalar(db,'select editorial_enable_plan_gate()');
 await db.exec('set role terraveler_service');
 await assert.rejects(scalar(db,"select editorial_enqueue(1,'research','bypass','{}',null)"),/reviewed editorial plan required/);
 await assert.rejects(scalar(db,"select editorial_start_pipeline(1,'bypass','bypass-request')"),/reviewed editorial plan required/);
 const run=await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-request-00001']);
 assert.equal((await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-request-00001'])).replayed,true);
 assert.equal(await scalar(db,"select editorial_claim('worker',array['writer'],120)"),null);
 await assert.rejects(scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[2,prep.plan_id,'wrong-topic-dispatch-001']),/topic not found|reviewed plan required/);
 await assert.rejects(scalar(db,'select editorial_enable_plan_gate()'),/permission denied/);
 for(let i=0;i<2;i++){
  const task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
  assert.equal(task.input.plan_id,prep.plan_id);assert.equal(task.agent_config.agent_key,'historian');
  const receipt=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[task.id,task.attempt,'worker']);
  const result=executeHandler(task,receipt);assert.equal(result.verification,'candidate-only');
  await assert.rejects(scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,{...result,references:receipt.sources},{}]),/invalid or revoked MCP receipt/);
  await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,result,{}]);
  if(i===0)assert.equal(await scalar(db,"select editorial_claim('worker',array['writer'],120)"),null);
 }
 await db.exec('reset role');
 await db.exec("insert into source_policy_decisions values(2,1,'reject',null,'unknown',now()+interval '1 second')");
 await assert.rejects(scalar(db,"select editorial_claim('worker',array['writer'],120)"),/source policy changed/);
 await db.exec('delete from source_policy_decisions where id=2');
 await db.exec('set role terraveler_service');
 const writer=await scalar(db,"select editorial_claim('worker',array['writer'],120)");
 assert.equal(writer.input.research_result.findings.length,2);assert.equal(writer.input.research_result.references.length,1);
 const draft=executeHandler(writer);assert.equal(draft.verification,'candidate-only');
 const saved=await scalar(db,'select editorial_complete($1,$2,$3,$4)',[writer.id,writer.lease_token,draft,{}]);
 const reviewer=await scalar(db,"select editorial_claim('worker',array['reviewer'],120)");
 assert.equal(reviewer.dependency_id,writer.id);assert.equal(reviewer.input.draft_result.title,'Example');
 await scalar(db,'select editorial_complete($1,$2,$3,$4)',[reviewer.id,reviewer.lease_token,executeHandler(reviewer),{}]);
 assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'awaiting-editor');
 assert.equal(await scalar(db,'select count(*)::int from editorial_results where id=$1',[saved.result_id]),1);
 assert.equal(await scalar(db,'select count(*)::int from submissions'),1);
 await db.exec('reset role');
 await db.exec('set role terraveler_editorial_worker');await assert.rejects(scalar(db,'select editorial_dispatch_plan(1,1,\'another-dispatch-0001\')'),/permission denied/);
 }finally{await db.close();}
});
