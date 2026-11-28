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
        assert task["input"]["work_item"]["specialty"] in ("history","ethnohistory","itinerary")
        candidate={"kind":"research","findings":[{"text":"Departure","source_ids":["rag:1"],"quotes":[]}],"uncertainties":[]}
        if task["input"]["work_item"]["specialty"]=="itinerary":
            candidate["waypoints"]=[{"id":"departure","sequence":1,"place_historical":"Example port","place_modern":"Example, Spain","latitude":36.5,"longitude":-6.3,"arrival_date":None,"departure_date":"1527-06","date_note":None,"event":"Departure","coordinate_note":"Modern harbour centre","source_ids":["rag:1"],"confidence":"approximate","uncertainty":"Exact anchorage unknown"}]
    elif task["role"]=="writer":
        assert len(task["input"]["research_result"]["findings"])>=1
        candidate={"kind":"draft","title":"Example","paragraphs":[{"text":"They departed.","source_id":"rag:1"}]}
    else:
        assert task["input"]["draft_result"]["title"]=="Example"
        revision=task["input"].get("revision",0)
        verdict=request.get("review_verdicts",{}).get(str(revision),"ready-for-editor")
        if isinstance(verdict,dict): verdict=verdict.get(task["input"]["work_item"]["specialty"],"ready-for-editor")
        issues=[] if verdict=="ready-for-editor" else [task["input"]["work_item"]["specialty"]+" revision "+str(revision)+" requires correction"]
        candidate={"kind":"review","verdict":verdict,"issues":issues}
    return {"candidate":candidate,"verification":"not-verified"}
if task["role"]=="research": result=research(task,conf,retrieve=retrieve,generator=generate)
elif task["role"]=="writer": result=writer(task,conf,generator=generate)
else: result=reviewer(task,conf,generator=generate)
json.dump(result,sys.stdout)
`;
function executeHandler(task,receipt=null,reviewVerdicts={}){const child=spawnSync('python3',['-c',python],{cwd:root,env:{...process.env,PYTHONPATH:root},input:JSON.stringify({task,receipt,review_verdicts:reviewVerdicts}),encoding:'utf8',timeout:10000,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr||child.error?.message);return JSON.parse(child.stdout);}
const names=['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline','editorial_chat','editorial_specialists','editorial_agent_specialties','editorial_mcp_plans','editorial_preparation','editorial_mcp_corpus','editorial_plan_dispatch','editorial_dossier_sources','editorial_textual_newsroom','editorial_task_retry','editorial_graph_revisions','editorial_waypoints','editorial_commons_images','editorial_iconography','editorial_image_text_editor','editorial_claim_run_priority'];
const migration=await Promise.all(names.map(n=>readFile(new URL(`../supabase/${n}.sql`,import.meta.url),'utf8')));
test('dispatch migration contains one definition per function and balanced SQL dollar quotes',()=>{
 const sql=migration.at(-1);
 const definitions=[...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map(m=>m[1]);
 assert.equal(new Set(definitions).size,definitions.length);
 assert.equal((sql.match(/\$\$/g)||[]).length%2,0);
 assert.doesNotMatch(sql,/(?:as |\n)\$(?!\$)[;\n]/);
 assert.match(sql,/\ncommit;\s*$/);
});
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
async function fixture(){const db=new PGlite();await db.exec(`create role terraveler_service;create role visitor;create role terraveler_editorial_worker;
 create table submissions(id bigint primary key,status text,payload jsonb,target_voyage text);
 create table rag_docs(id bigint primary key,voyage_slug text,type text,title text,content text,source_url text,license text);
 create table source_endpoints(id bigint primary key,host_pattern text,match_type text,status text,trust_mode text);
 create table source_policy_decisions(id bigint primary key,endpoint_id bigint,decision_outcome text,trust_mode text,rights_class text,timestamp timestamptz);
 insert into submissions values(1,'approved','{}','example');
 insert into rag_docs values(1,'example','text','Journal','They departed.','https://example.org/journal','Public domain');
 insert into source_endpoints values(1,'example.org','exact','active','domain_trusted');
 insert into source_policy_decisions values(1,1,'approve','domain_trusted','public_domain',now());`);
 for(const sql of migration)await db.exec(sql);
 await db.exec(migration.at(-1));
 assert.equal((await scalar(db,"select editorial_attach(1,'example','Example','Research')")).topic_id,1);
 return db;
}
async function saveAgent(db,key,role,specialty){const result=await scalar(db,'select desk_save_editorial_specialist_agent($1,$1,$2,$3,$4,true,0,$5,$6)',[key,role,'offline','instructions','agent-request-'+key+'-0001',specialty]);assert.ok(!result.error,JSON.stringify(result));}
async function preparation(db,items){const url='https://en.wikipedia.org/wiki/Example';
 const rec=await scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',['get_wikipedia_outline',{url},JSON.stringify({kind:'wikipedia-orientation',purpose:'planning-only',requested_url:url,revision_id:123,sections:[{index:'1',title:'History'}],text:'Orientation',text_truncated:false,sections_truncated:false,external_links_truncated:false})]);
 const planner=await scalar(db,"select id from editorial_agent_versions where agent_key='planner'");
 const reviewer=await scalar(db,"select id from editorial_agent_versions where agent_key='reviewer'");
 return scalar(db,'select editorial_record_preparation($1,$2,$3,$4,$5,$6,$7,$8,$9)',[1,0,'prepared-request-00001',null,url,{orientation_receipt_id:rec.id,gaps:[],work_items:items},planner,reviewer,{verdict:'adequate-for-next-stage',issues:[]}]);
}
const item=(id,specialty,depends_on)=>({id,specialty,question:id,deliverable:'artifact',depends_on,source_receipt_ids:[]});
test('enabled managing editor remains configurable with explicit and inherited specialty',async()=>{
 const db=await fixture();
 try {
  await saveAgent(db,'planner','coordinator','managing-editor');
  const updated=await scalar(db,`select desk_save_editorial_specialist_agent(agent_key,name,role,model,instructions||' revised',enabled,version,'planner-revision-request-001',null) from editorial_agents_current where agent_key='planner'`);
  assert.equal(updated.version,2);assert.equal(updated.specialty,'managing-editor');
 }finally{await db.close();}
});
test('reviewed plan schedules all dependencies, blocks legacy bypass, requires real MCP receipt, and ends at private draft review',async()=>{
 const db=await fixture();
 try {
 for(const [key,role,specialty] of [['planner','coordinator',null],['reviewer','reviewer','factcheck'],['historian','research','history'],['writer','writer','diary']])await saveAgent(db,key,role,specialty);
 const prep=await preparation(db,[item('history-a','history',[]),item('history-b','history',[]),item('diary','diary',['history-a','history-b']),item('check','factcheck',['diary'])]);
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
 await db.exec('reset role');
 assert.equal(await scalar(db,'select count(*)::int from submissions'),1);
 await db.exec('set role terraveler_editorial_worker');await assert.rejects(scalar(db,'select editorial_dispatch_plan(1,1,\'another-dispatch-0001\')'),/permission denied/);
 }finally{await db.close();}
});
test('full textual newsroom binds three research tasks, two drafts and four targeted reviews without publication',async()=>{
 const db=await fixture();
 try {
 for(const [key,role,specialty] of [
  ['planner','coordinator',null],['reviewer','reviewer','factcheck'],['copyeditor','reviewer','copyedit'],
  ['historian','research','history'],['ethnographer','research','ethnohistory'],['navigator','research','itinerary'],
  ['diarist','writer','diary'],['essayist','writer','editorial'],
 ])await saveAgent(db,key,role,specialty);
 const prep=await preparation(db,[
  item('history','history',[]),item('ethnohistory','ethnohistory',[]),item('itinerary','itinerary',[]),
  item('diary','diary',['history','ethnohistory','itinerary']),item('editorial','editorial',['history','ethnohistory','itinerary']),
  item('diary-copy','copyedit',['diary']),item('diary-check','factcheck',['diary']),
  item('editorial-copy','copyedit',['editorial']),item('editorial-check','factcheck',['editorial']),
 ]);
 await scalar(db,'select editorial_enable_plan_gate()');
 await db.exec('set role terraveler_service');
 const run=await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-full-00001']);
 assert.equal((await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-full-00001'])).replayed,true);
 assert.equal(await scalar(db,'select count(*)::int from editorial_graph_tasks where run_id=$1',[run.run_id]),9);
 assert.equal(await scalar(db,"select editorial_claim('worker',array['writer','reviewer'],120)"),null);
 for(let i=0;i<3;i++){
  const task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
  assert.ok(['history','ethnohistory','itinerary'].includes(task.input.work_item.specialty));
  const receipt=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[task.id,task.attempt,'worker']);
  await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,executeHandler(task,receipt),{}]);
 }
 assert.equal(await scalar(db,'select count(distinct task_id)::int from editorial_corpus_consultations'),3);
 assert.equal(await scalar(db,"select count(*)::int from editorial_corpus_consultations where snapshot_sha256 !~ '^[0-9a-f]{64}$'"),0);
 const drafts={};
 for(let i=0;i<2;i++){
  const task=await scalar(db,"select editorial_claim('worker',array['writer'],120)");
  assert.equal(task.input.research_result.findings.length,3);
  assert.equal(task.input.research_result.waypoints.length,1);
  assert.equal(task.input.research_result.waypoints[0].coordinate_note,'Modern harbour centre');
  assert.deepEqual([...task.input.work_item.depends_on].sort(),['ethnohistory','history','itinerary']);
  const result=executeHandler(task);
  assert.deepEqual(result.waypoints,task.input.research_result.waypoints);
  await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,result,{}]);
  drafts[task.input.work_item_id]=task;
 }
 assert.deepEqual(Object.keys(drafts).sort(),['diary','editorial']);
 for(let i=0;i<4;i++){
  const task=await scalar(db,"select editorial_claim('worker',array['reviewer'],120)");
  const draftId=task.input.work_item.depends_on[0];
  assert.equal(task.dependency_id,drafts[draftId].id);
  assert.equal(task.input.draft_result.body,'They departed.');
  assert.ok(['copyedit','factcheck'].includes(task.input.work_item.specialty));
  await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,executeHandler(task),{}]);
 }
 const bindings=(await db.query(`select m.work_item_id,t.dependency_id,t.input->'work_item'->>'specialty' as specialty,
  (select count(*)::int from editorial_graph_edges e where e.task_id=t.id) as edge_count
  from editorial_tasks t join editorial_graph_tasks m on m.task_id=t.id where t.role='reviewer' order by m.work_item_id`)).rows;
 assert.equal(bindings.length,4);
 for(const binding of bindings){assert.equal(binding.dependency_id,drafts[binding.work_item_id.split('-')[0]].id);assert.equal(binding.edge_count,1);}
 for(const id of ['diary','editorial'])assert.deepEqual(bindings.filter(b=>b.dependency_id===drafts[id].id).map(b=>b.specialty).sort(),['copyedit','factcheck']);
 assert.equal(await scalar(db,'select count(*)::int from editorial_graph_edges'),10);
 assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'awaiting-editor');
 assert.equal(await scalar(db,'select task_count from editorial_graph_status where id=$1',[run.run_id]),9);
 assert.equal(await scalar(db,'select completed_count from editorial_graph_status where id=$1',[run.run_id]),9);
 assert.equal(await scalar(db,'select count(*)::int from editorial_results'),9);
 await db.exec('reset role');
 assert.equal(await scalar(db,'select count(*)::int from submissions'),1);
 }finally{await db.close();}
});


test('editor retry grants one audited attempt without resetting history or changing the run',async()=>{
 const db=await fixture();
 try {
  for(const [key,role,specialty] of [['planner','coordinator',null],['reviewer','reviewer','factcheck'],['historian','research','history'],['writer','writer','diary']])await saveAgent(db,key,role,specialty);
  const prep=await preparation(db,[item('history','history',[]),item('diary','diary',['history']),item('check','factcheck',['diary'])]);
  await scalar(db,'select editorial_enable_plan_gate()');
  await db.exec('set role terraveler_service');
  const run=await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-retry-000001']);
  let task;
  for(let attempt=1;attempt<=3;attempt++){
   task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
   assert.equal(task.attempt,attempt);
   assert.equal(await scalar(db,'select editorial_fail($1,$2,$3)',[task.id,task.lease_token,'gateway-unavailable']),true);
  }
  assert.equal(await scalar(db,'select state from editorial_tasks where id=$1',[task.id]),'attention');
  assert.equal(await scalar(db,"select editorial_claim('worker',array['research'],120)"),null);
  await assert.rejects(scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',[task.id,2,'editor-retry-stale-001','Stale approval']),/stale task attempt/);
  await assert.rejects(scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',[task.id,3,'editor-retry-control-001','line\nbreak']),/invalid retry request/);
  const args=[task.id,3,'editor-retry-request-001','Provider connectivity restored'];
  const receipt=await scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',args);
  assert.deepEqual(receipt,{task_id:task.id,run_id:run.run_id,attempt:3,max_attempts:4,replayed:false});
  const replay=await scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',args);
  assert.deepEqual(replay,{...receipt,replayed:true});
  await assert.rejects(scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',[task.id,3,args[2],'Changed reason']),/retry idempotency conflict/);
  assert.equal(await scalar(db,'select attempt from editorial_tasks where id=$1',[task.id]),3);
  assert.equal(await scalar(db,'select state from editorial_tasks where id=$1',[task.id]),'queued');
  assert.equal(await scalar(db,"select count(*)::int from editorial_task_events where task_id=$1 and event='editor-retry-authorized'",[task.id]),1);
  await db.exec('reset role;set role terraveler_editorial_worker');
  await assert.rejects(scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',[task.id,3,'editor-retry-worker-001','Worker cannot authorize']),/permission denied/);
  await db.exec('reset role;set role terraveler_service');
  task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
  assert.equal(task.attempt,4);assert.equal(task.max_attempts,4);
  const corpus=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[task.id,task.attempt,'worker']);
  const saved=await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,executeHandler(task,corpus),{}]);
  assert.ok(saved.result_id);
  assert.equal(await scalar(db,'select state from editorial_tasks where id=$1',[task.id]),'completed');
  assert.deepEqual(await scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',args),{...receipt,replayed:true});
  await assert.rejects(scalar(db,'select desk_retry_editorial_task($1,$2,$3,$4)',[task.id,4,'editor-retry-second-001','No automatic retry']),/task is not retryable/);
  assert.ok(await scalar(db,"select editorial_claim('worker',array['writer'],120)"));
  await db.exec('reset role');
  assert.equal(await scalar(db,'select count(*)::int from submissions'),1);
 }finally{await db.close();}
});


async function revisionRun(db,reviewers=['factcheck']){
 const full=reviewers.includes('copyedit');
 for(const [key,role,specialty] of [['planner','coordinator',null],['historian','research','history'],['diarist','writer','diary']])await saveAgent(db,key,role,specialty);
 if(full)await saveAgent(db,'essayist','writer','editorial');
 for(const specialty of reviewers)await saveAgent(db,specialty==='copyedit'?'copyeditor':'reviewer','reviewer',specialty);
 const writers=full?['diary','editorial']:['diary'];
 const items=[item('history','history',[]),...writers.map(writer=>item(writer,writer,['history']))];
 for(const writer of writers)for(const specialty of reviewers)items.push(item(`${writer}-${specialty}`,specialty,[writer]));
 const prep=await preparation(db,items);
 await scalar(db,'select editorial_enable_plan_gate()');
 await db.exec('set role terraveler_service');
 return scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-revisions-0001']);
}
async function completeRole(db,role,verdicts={}){
 const task=await scalar(db,"select editorial_claim('worker',array[$1],120)",[role]);
 assert.ok(task,`expected a claimable ${role} task`);
 let receipt=null;
 if(role==='research')receipt=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[task.id,task.attempt,'worker']);
 const result=executeHandler(task,receipt,verdicts);
 const saved=await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,result,{}]);
 assert.ok(saved.result_id);
 return {task,result,saved};
}
async function storedResult(db,taskId){return scalar(db,'select result from editorial_results where task_id=$1',[taskId]);}
async function assertNoPublication(db){
 await db.exec('reset role');
 assert.equal(await scalar(db,'select count(*)::int from submissions'),1);
}

test('changes-requested creates one revised draft and new review, then converges without changing history',async()=>{
 const db=await fixture();
 try{
  const run=await revisionRun(db);
  await completeRole(db,'research');
  const initialDraft=await completeRole(db,'writer');
  const initialReview=await completeRole(db,'reviewer',{'0':'changes-requested'});
  assert.equal(initialReview.task.input.revision??0,0);
  const revisedDraft=await completeRole(db,'writer');
  assert.equal(revisedDraft.task.input.revision,1);
  assert.equal(revisedDraft.task.input.draft_result.kind,'draft');
  assert.equal(revisedDraft.task.input.review_result.verdict,'changes-requested');
  assert.equal(revisedDraft.task.input.review_result.source_reviews[0].task_id,initialReview.task.id);
  assert.equal(revisedDraft.task.input.review_result.source_reviews[0].result_id,initialReview.saved.result_id);
  assert.equal(revisedDraft.task.input.research_result.kind,'research');
  assert.deepEqual(await storedResult(db,initialDraft.task.id),initialDraft.result);
  assert.deepEqual(await storedResult(db,initialReview.task.id),initialReview.result);
  const revisedReview=await completeRole(db,'reviewer',{'1':'ready-for-editor'});
  assert.equal(revisedReview.task.input.revision,1);
  assert.equal(revisedReview.task.dependency_id,revisedDraft.task.id);
  assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'awaiting-editor');
  assert.equal(await scalar(db,'select task_count from editorial_graph_status where id=$1',[run.run_id]),3);
  assert.equal(await scalar(db,'select completed_count from editorial_graph_status where id=$1',[run.run_id]),3);
  assert.equal(await scalar(db,'select count(*)::int from editorial_results'),5);
  assert.equal(await scalar(db,"select editorial_claim('worker',array['writer','reviewer'],120)"),null);
  await assertNoPublication(db);
 }finally{await db.close();}
});

test('two automatic revisions are the hard limit and the third changes-requested stops at attention',async()=>{
 const db=await fixture();
 try{
  const run=await revisionRun(db);
  await completeRole(db,'research');
  const verdicts={'0':'changes-requested','1':'changes-requested','2':'changes-requested'};
  for(let revision=0;revision<=2;revision++){
   const draft=await completeRole(db,'writer');
   assert.equal(draft.task.input.revision??0,revision);
   const review=await completeRole(db,'reviewer',verdicts);
   assert.equal(review.task.input.revision??0,revision);
  }
  assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'attention');
  assert.equal(await scalar(db,'select revision from editorial_graph_status where id=$1',[run.run_id]),2);
  assert.equal(await scalar(db,'select count(*)::int from editorial_graph_tasks where run_id=$1 and revision=3',[run.run_id]),0);
  assert.equal(await scalar(db,'select count(*)::int from editorial_results'),7);
  assert.equal(await scalar(db,"select editorial_claim('worker',array['writer','reviewer'],120)"),null);
  await assertNoPublication(db);
 }finally{await db.close();}
});

test('blocked review never schedules an automatic revision',async()=>{
 const db=await fixture();
 try{
  const run=await revisionRun(db);
  await completeRole(db,'research');
  await completeRole(db,'writer');
  await completeRole(db,'reviewer',{'0':'blocked'});
  assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'attention');
  assert.equal(await scalar(db,'select count(*)::int from editorial_graph_tasks where run_id=$1 and revision>0',[run.run_id]),0);
  assert.equal(await scalar(db,"select editorial_claim('worker',array['writer','reviewer'],120)"),null);
  await assertNoPublication(db);
 }finally{await db.close();}
});

test('copyedit and factcheck must both finish before revision and their issues and source IDs survive composition',async()=>{
 const db=await fixture();
 try{
  const run=await revisionRun(db,['copyedit','factcheck']);
  await completeRole(db,'research');
  const initialDraft=await completeRole(db,'writer');
  await completeRole(db,'writer');
  const diaryVerdicts={'0':{copyedit:'changes-requested',factcheck:'changes-requested'}};
  const firstReview=await completeRole(db,'reviewer',diaryVerdicts);
  assert.equal(await scalar(db,'select count(*)::int from editorial_graph_tasks where run_id=$1 and revision=1',[run.run_id]),0);
  const secondReview=await completeRole(db,'reviewer',diaryVerdicts);
  const revisedDraft=await completeRole(db,'writer');
  const composition=revisedDraft.task.input.review_result;
  assert.equal(revisedDraft.task.input.work_item_id,'diary');
  assert.equal(composition.verdict,'changes-requested');
  assert.equal(composition.issues.length,2);
  assert.deepEqual(new Set(composition.source_reviews.map(review=>review.result_id)),new Set([firstReview.saved.result_id,secondReview.saved.result_id]));
  assert.deepEqual(new Set(composition.source_reviews.map(review=>review.task_id)),new Set([firstReview.task.id,secondReview.task.id]));
  assert.deepEqual(await storedResult(db,initialDraft.task.id),initialDraft.result);
  await completeRole(db,'reviewer',{'0':'ready-for-editor'});
  await completeRole(db,'reviewer',{'0':'ready-for-editor'});
  await completeRole(db,'reviewer',{'1':'ready-for-editor'});
  await completeRole(db,'reviewer',{'1':'ready-for-editor'});
  assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'awaiting-editor');
  assert.equal(await scalar(db,'select task_count from editorial_graph_status where id=$1',[run.run_id]),7);
  assert.equal(await scalar(db,'select count(*)::int from editorial_results'),10);
  await assertNoPublication(db);
 }finally{await db.close();}
});

test('revision helpers and arbitrary graph input cannot bypass the governed scheduler',async()=>{
 const db=await fixture();
 try{
  const run=await revisionRun(db);
  await assert.rejects(scalar(db,'select editorial_graph_add_revision($1,$2,$3,$4,$5)',[run.run_id,'diary',1,null,{}]),/permission denied/);
  await assert.rejects(scalar(db,'select editorial_graph_revision_input($1,$2,$3)',[run.run_id,'diary',1]),/permission denied/);
  await db.exec('reset role;set role terraveler_editorial_worker');
  await assert.rejects(scalar(db,'select editorial_graph_add_revision($1,$2,$3,$4,$5)',[run.run_id,'diary',1,null,{}]),/permission denied/);
  await db.exec('reset role');
  await assert.rejects(scalar(db,'select editorial_graph_add_revision($1,$2,$3,$4,$5)',[run.run_id,'diary',3,null,{}]),/invalid plan revision/);
  await assert.rejects(db.query("insert into editorial_tasks(topic_id,role,task_key,input) values(1,'writer','arbitrary-revision',jsonb_build_object('graph_run_id',$1::bigint,'work_item_id','diary','revision',3))",[run.run_id]),/invalid plan revision/);
  await assert.rejects(scalar(db,'select editorial_graph_add_revision($1,$2,$3,$4,$5)',[run.run_id,'diary',1,null,{}]),/invalid plan revision/);
  assert.equal(await scalar(db,'select count(*)::int from editorial_graph_tasks where run_id=$1',[run.run_id]),3);
  await assertNoPublication(db);
 }finally{await db.close();}
});

const commonsImage=(title,patch={})=>({kind:'commons-image',title,page_url:'https://commons.wikimedia.org/wiki/'+title.replace(/ /g,'_'),page_id:101,revision_id:9001,
 image_url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg',thumb_url:null,mime:'image/jpeg',width:800,height:600,sha1:'a'.repeat(40),
 licence:{usable:true,class:'public_domain',code:'pd',short_name:'Public domain',url:null,attribution_required:false},
 artist:'Theodor de Bry',credit:null,date_original:'1591',date_year:1591,description:'Engraving.',object_name:null,restrictions:[],...patch});
const crew=[['planner','coordinator',null],['reviewer','reviewer','factcheck'],['historian','research','history'],['photo-editor','research','iconography'],['writer','writer','diary'],['image-text-editor','writer','caption']];
const imagePlan=()=>[item('history-a','history',[]),item('images','iconography',['history-a']),item('diary','diary',['history-a']),item('check','factcheck',['diary']),
 item('captions','caption',['images']),item('captions-check','factcheck',['captions'])];
test('Photo editor follows textual research; Image text editor captions exactly the verified selection; writers never see images',async()=>{
 const db=await fixture();
 try {
 for(const [key,role,specialty] of crew)await saveAgent(db,key,role,specialty);
 const prep=await preparation(db,imagePlan());
 await scalar(db,'select editorial_enable_plan_gate()');
 await db.exec('set role terraveler_service');
 const run=await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-images-000001']);
 const history=await scalar(db,"select editorial_claim('worker',array['research'],120)");
 assert.equal(history.input.work_item.specialty,'history','the Photo editor waits for textual research');
 assert.equal(await scalar(db,"select editorial_claim('worker',array['research'],120)"),null);
 const corpus=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[history.id,history.attempt,'worker']);
 await scalar(db,'select editorial_complete($1,$2,$3,$4)',[history.id,history.lease_token,executeHandler(history,corpus),{}]);
 const task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
 assert.equal(task.agent_config.agent_key,'photo-editor');
 assert.equal(task.input.dependency_research[0].work_item_id,'history-a','queries can use researched findings');
 const record=async title=>{const body=commonsImage(title);const r=await scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',['fetch_commons_image',{title},JSON.stringify(body)]);return {r,body};};
 const good=await record('File:De Bry Timucua.jpg'), second=await record('File:Moyne map.jpg');
 const selection=(rec,patch={})=>({receipt_id:rec.r.id,receipt_sha256:rec.r.response_sha256,snapshot:rec.body,depiction:'period-artwork',relevance:'Engraved in 1591 from a participant account.',caution:null,...patch});
 const iconResult=(imgs,extra={})=>({kind:'iconography',images:imgs,queries:['Timucua'],uncertainties:[],candidate:{},verification:'candidate-only',...extra});
 const complete=(t,value)=>scalar(db,'select editorial_complete($1,$2,$3,$4)',[t.id,t.lease_token,value,{}]);
 for(const bad of [
  iconResult([selection(good,{snapshot:{...good.body,licence:{...good.body.licence,class:'cc_by_nc'}}})]),
  iconResult([selection(good,{receipt_sha256:'0'.repeat(64)})]),
  iconResult([selection(good,{depiction:'eyewitness'})]),
  iconResult([selection(good,{relevance:'The "true" landing.'})]),
  iconResult([{...selection(good),image_url:'https://example.org/x.jpg'}]),
  iconResult([selection(good),selection(good)]),
  iconResult([]),
  {...iconResult([selection(good)]),kind:'research'},
 ]) await assert.rejects(complete(task,bad),/invalid Commons image receipt|duplicate image selection|must state why|wrong plan result kind/);
 const images=[selection(good),selection(second,{depiction:'period-map'})];
 await complete(task,iconResult(images));
 const display=[];for(const v of images)display.push(await scalar(db,'select editorial_image_display($1)',[v]));
 assert.equal(display[1].depiction,'period-map');assert.equal(display[0].licence.class,'public_domain');
 for(let i=0;i<2;i++){
  const w=await scalar(db,"select editorial_claim('worker',array['writer'],120)");
  if(w.input.work_item.specialty==='diary'){
   assert.equal(JSON.stringify(w.input).includes('De Bry Timucua'),false,'image selections never reach textual writers');
   await complete(w,executeHandler(w));continue;
  }
  assert.equal(w.agent_config.agent_key,'image-text-editor');
  assert.equal(w.input.research_result,undefined,'caption writers receive the selection, not research');
  assert.deepEqual(w.input.image_selection.images.map(v=>v.receipt_id),[good.r.id,second.r.id]);
  const entry=(k,patch={})=>({receipt_id:images[k].receipt_id,caption:'Engraving by Theodor de Bry, 1591.',alt_text:'Engraving of villagers.',image:display[k],...patch});
  const draft=(caps,extra={})=>({kind:'draft',format:'captions',captions:caps,candidate:null,verification:'candidate-only',...extra});
  for(const bad of [
   draft([entry(0)]),
   draft([entry(1),entry(0)]),
   draft([entry(0),entry(1,{image:{...display[1],artist:'Someone else'}})]),
   draft([entry(0),entry(1,{caption:'The "real" map.'})]),
   draft([entry(0),{...entry(1),note:'extra'}]),
   draft([entry(0),entry(1)],{format:'diary'}),
  ]) await assert.rejects(complete(w,bad),/invalid image captions/);
  await complete(w,draft([entry(0),entry(1)]));
 }
 for(let i=0;i<2;i++){
  const r=await scalar(db,"select editorial_claim('worker',array['reviewer'],120)");
  if(r.input.draft_result.format==='captions'){
   assert.equal(r.input.image_selection.images.length,2);assert.equal(r.input.research_result,undefined);
   await complete(r,{kind:'review',verdict:'ready-for-editor',issues:[],candidate:{},verification:'candidate-only'});
  } else await complete(r,executeHandler(r));
 }
 assert.equal(await scalar(db,'select state from editorial_graph_status where id=$1',[run.run_id]),'awaiting-editor');
 }finally{await db.close();}
});
test('image receipts must come from the same attempt and the image graph shape is enforced',async()=>{
 const db=await fixture();
 try {
 for(const [key,role,specialty] of crew)await saveAgent(db,key,role,specialty);
 const title='File:Early.jpg', body=commonsImage(title);
 await db.exec('set role terraveler_service');
 const early=await scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',['fetch_commons_image',{title},JSON.stringify(body)]);
 await db.exec('reset role');
 const prep=await preparation(db,imagePlan());
 await scalar(db,'select editorial_enable_plan_gate()');
 await db.exec('set role terraveler_service');
 await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[1,prep.plan_id,'dispatch-images-000002']);
 const history=await scalar(db,"select editorial_claim('worker',array['research'],120)");
 const corpus=await scalar(db,'select editorial_read_mcp_corpus($1,$2,$3)',[history.id,history.attempt,'worker']);
 await scalar(db,'select editorial_complete($1,$2,$3,$4)',[history.id,history.lease_token,executeHandler(history,corpus),{}]);
 const task=await scalar(db,"select editorial_claim('worker',array['research'],120)");
 await assert.rejects(scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,{kind:'iconography',images:[{receipt_id:early.id,receipt_sha256:early.response_sha256,snapshot:body,depiction:'period-artwork',relevance:'Older consultation.',caption:null}],queries:[],uncertainties:[],candidate:{},verification:'candidate-only'},{}]),/invalid Commons image receipt/);
 await assert.rejects(scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,{kind:'iconography',images:[{receipt_id:early.id,receipt_sha256:early.response_sha256,snapshot:body,depiction:'period-artwork',relevance:'Older consultation.',caution:null}],queries:[],uncertainties:[],candidate:{},verification:'candidate-only'},{}]),/invalid Commons image receipt/);
 await scalar(db,'select editorial_complete($1,$2,$3,$4)',[task.id,task.lease_token,{kind:'iconography',images:[],queries:['x'],uncertainties:['No suitable image.'],candidate:{},verification:'candidate-only'},{}]);
 const w=await scalar(db,"select editorial_claim('worker',array['writer'],120)");
 if(w.input.work_item.specialty==='caption'){
  assert.deepEqual(w.input.image_selection.images,[]);
  await scalar(db,'select editorial_complete($1,$2,$3,$4)',[w.id,w.lease_token,{kind:'draft',format:'captions',captions:[],candidate:null,verification:'candidate-only'},{}]);
 }
 }finally{await db.close();}
 const h=item('history-a','history',[]),fc=(id,dep)=>item(id,'factcheck',[dep]),d=item('diary','diary',['history-a']);
 for(const [why,items] of [
  ['images without research',[h,item('images','iconography',[]),d,fc('check','diary'),item('captions','caption',['images']),fc('cc','captions')]],
  ['two image items',[h,item('img-a','iconography',['history-a']),item('img-b','iconography',['history-a']),d,fc('check','diary')]],
  ['research after images',[h,item('history-b','history',['images']),item('images','iconography',['history-a']),item('diary','diary',['history-a','history-b']),fc('check','diary')]],
  ['diary on images',[h,item('images','iconography',['history-a']),item('diary','diary',['history-a','images']),fc('check','diary')]],
  ['caption on research',[h,item('images','iconography',['history-a']),d,fc('check','diary'),item('captions','caption',['history-a']),fc('cc','captions')]],
  ['caption without images',[h,d,fc('check','diary'),item('captions','caption',[]),fc('cc','captions')]],
  ['two captions',[h,item('images','iconography',['history-a']),d,fc('check','diary'),item('cap-a','caption',['images']),fc('ca','cap-a'),item('cap-b','caption',['images']),fc('cb','cap-b')]],
  ['caption without factcheck',[h,item('images','iconography',['history-a']),d,fc('check','diary'),item('captions','caption',['images'])]],
 ]){
  const x=await fixture();
  try {
   for(const [key,role,specialty] of crew)await saveAgent(x,key,role,specialty);
   const p=await preparation(x,items);
   await assert.rejects(scalar(x,'select editorial_dispatch_plan($1,$2,$3)',[1,p.plan_id,'dispatch-images-bad-001']),/at most one iconography|unsupported editorial dependency graph|one factcheck per writer/,why);
  }finally{await x.close();}
 }
});

test('an older dossier\'s revision is claimed before a newer dossier\'s first task',async()=>{
 const db=await fixture();
 try{
  const first=await revisionRun(db);
  // A second dossier is dispatched while the first is still at research.
  await db.exec('reset role');
  await db.exec("insert into submissions values(2,'approved','{}','example')");
  assert.equal((await scalar(db,"select editorial_attach(2,'example-two','Example two','Research')")).topic_id,2);
  const url='https://en.wikipedia.org/wiki/Example';
  const rec=await scalar(db,'select editorial_record_mcp_consultation($1,$2,$3)',['get_wikipedia_outline',{url},JSON.stringify({kind:'wikipedia-orientation',purpose:'planning-only',requested_url:url,revision_id:124,sections:[{index:'1',title:'History'}],text:'Orientation',text_truncated:false,sections_truncated:false,external_links_truncated:false})]);
  const planner=await scalar(db,"select id from editorial_agent_versions where agent_key='planner'");
  const reviewer=await scalar(db,"select id from editorial_agent_versions where agent_key='reviewer'");
  const prep=await scalar(db,'select editorial_record_preparation($1,$2,$3,$4,$5,$6,$7,$8,$9)',[2,0,'prepared-request-00002',null,url,{orientation_receipt_id:rec.id,gaps:[],work_items:[item('history','history',[]),item('diary','diary',['history']),item('diary-factcheck','factcheck',['diary'])]},planner,reviewer,{verdict:'adequate-for-next-stage',issues:[]}]);
  await db.exec('set role terraveler_service');
  const second=await scalar(db,'select editorial_dispatch_plan($1,$2,$3)',[2,prep.plan_id,'dispatch-second-00001']);
  assert.ok(second.run_id>first.run_id);
  await completeRole(db,'research');
  await completeRole(db,'writer');
  await completeRole(db,'reviewer',{'0':'changes-requested'});
  // Queued now: the second dossier's research (lower id) and the first
  // dossier's revised draft (created last, highest id).
  const next=await scalar(db,"select editorial_claim('worker',array['research','writer'],120)");
  assert.equal(next.input.graph_run_id,first.run_id,'the dossier nearer completion goes first');
  assert.equal(next.input.revision,1);
 }finally{await db.close();}
});
