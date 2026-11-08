import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';

const root=fileURLToPath(new URL('../',import.meta.url));
const migrations=await Promise.all(['editorial_workflow','editorial_team','editorial_agent_binding','editorial_pipeline','editorial_chat'].map(name=>readFile(new URL(`../supabase/${name}.sql`,import.meta.url),'utf8')));
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
// Each invocation is a new Python process: no previous-stage memory or mocked
// scheduler survives. Only the PostgreSQL claim carries immutable dependencies.
const python=String.raw`
import json,sys
from orchestration.editorial_handlers import research,writer,reviewer
from orchestration.editorial_sources import retrieve_sources
from orchestration.editorial_gateway import GatewayConfig
request=json.load(sys.stdin)
task=request['task']
config=GatewayConfig('http://offline-limen:8080','fixture-virtual-key','editorial')
row={'id':7,'voyage_slug':'boudeuse-1766','title':'Journal','content':'They departed in 1766.','source_url':'https://www.gutenberg.org/ebooks/1','license':'Public domain'}
policy={'matched':True,'decision':'allow','trust_mode':'domain_trusted','rights_class':'public_domain','endpoint_id':1,'policy_decision_id':1}
def retrieve(task):
    return retrieve_sources(task,read_rows=lambda scopes:[row],resolve=lambda url:policy)
def generate(task,cfg):
    assert cfg is config
    assert task['agent_config']['model']=='offline-fixture'
    if task['role']=='research':
        candidate={'kind':'research','findings':[{'text':'Departure in 1766','source_ids':['rag:7'],'quotes':[{'source_id':'rag:7','text':'They departed in 1766.'}]}],'uncertainties':[]}
    elif task['role']=='writer':
        assert task['input']['research_result']['references'][0]['id']=='rag:7'
        if task['input']['revision']:
            assert task['input']['review_result']['verdict']=='changes-requested'
            assert task['input']['draft_result']['title']=='Initial article'
        candidate={'kind':'draft','title':'Revised article' if task['input']['revision'] else 'Initial article','body':'They departed in 1766.','citations':[{'source_id':'rag:7','claim':'They departed in 1766.','quote':'They departed in 1766.'}]}
    else:
        assert task['input']['draft_result']['citations'][0]['source_id']=='rag:7'
        candidate={'kind':'review','verdict':'ready-for-editor' if task['input']['revision'] else 'changes-requested','issues':[] if task['input']['revision'] else ['Clarify the article title.']}
    return {'candidate':candidate,'verification':'not-verified','agent_key':task['agent_config']['agent_key'],'agent_version':task['agent_config']['version'],'requested_model':task['agent_config']['model']}
if task['role']=='research':
    result=research(task,config,retrieve=retrieve,generator=generate)
elif task['role']=='writer':
    result=writer(task,config,generator=generate)
else:
    result=reviewer(task,config,generator=generate)
json.dump(result,sys.stdout)
`;
function executeHandler(task){
 const child=spawnSync('python3',['-c',python],{cwd:root,env:{...process.env,PYTHONPATH:root},input:JSON.stringify({task}),encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 assert.equal(child.status,0,child.stderr||child.error?.message);
 return JSON.parse(child.stdout);
}

test('chat → real offline handlers → durable rewrite → editor, across independent worker processes',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role terraveler_service;create role visitor;
   create table submissions(id bigint primary key,status text,payload jsonb,target_voyage text);
   insert into submissions values(111,'approved','{"title":"Journal synthesis"}','boudeuse-1766');`);
  for(const sql of migrations)await db.exec(sql);
  const intake=await scalar(db,`select editorial_start(111,'boudeuse','Journal synthesis','Reconcile sources')`);
  // The explicit pipeline supersedes the older single-stage intake task.
  await db.query(`update editorial_tasks set state='attention' where id=$1`,[intake.task_id]);
  for(const role of ['research','writer','reviewer','coordinator'])
   await scalar(db,`select desk_save_editorial_agent($1,$1,$1,'offline-fixture','Use only source-bound candidate material',true,0,$2)`,[role,`save-agent-${role}-0001`]);
  const before=(await db.query('select * from submissions')).rows;
  const chat=await scalar(db,`select editorial_chat_begin($1,'Prepare this dossier','end-to-end-chat-0001')`,[intake.topic_id]);
  const chatArgs=[chat.request_id,chat.lease_token,'start_pipeline','Preparing a source-bound article.','Synthesize the approved journal sources'];
  const receipt=await scalar(db,'select editorial_chat_complete($1,$2,$3,$4,$5)',chatArgs);
  assert.deepEqual(await scalar(db,'select editorial_chat_complete($1,$2,$3,$4,$5)',chatArgs),receipt);
  const runId=receipt.action_receipt.run_id;
  const outputs=[];
  const pids=[];
  for(const role of ['research','writer','reviewer','writer','reviewer']){
   let task=await scalar(db,`select editorial_claim('restarted-worker',array[$1]::text[],120)`,[role]);
   assert.ok(task,`missing ${role} stage`);
   assert.equal(task.sources[0].target_voyage,'boudeuse-1766');
   if(!outputs.length){
    // Crash before acceptance: recovery grants a new attempt; stale output
    // cannot schedule the writer or commit an artifact.
    const stale=task;
    await db.query(`update editorial_tasks set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1`,[task.id]);
    await scalar(db,'select editorial_recover()');
    task=await scalar(db,`select editorial_claim('restarted-worker',array[$1]::text[],120)`,[role]);
    assert.notEqual(task.lease_token,stale.lease_token);
    await assert.rejects(scalar(db,`select editorial_complete($1,$2,$3,'{}')`,[stale.id,stale.lease_token,JSON.stringify(executeHandler(stale))]),/stale lease/);
    assert.equal(await scalar(db,'select count(*)::int from editorial_results'),0);
   }
   const result=executeHandler(task);
   assert.equal(result.verification,'candidate-only');
   outputs.push(result);
   const args=[task.id,task.lease_token,JSON.stringify(result),JSON.stringify({worker_process:'fresh-python-process',candidate_only:true})];
   const accepted=await scalar(db,'select editorial_complete($1,$2,$3,$4)',args);
   const replay=await scalar(db,'select editorial_complete($1,$2,$3,$4)',args);
   assert.equal(replay.result_id,accepted.result_id);
   // Reapplying migrations simulates application restart/deployment and must
   // preserve accepted artifacts and the single queued successor.
   await db.exec(migrations[3]);
  }
  assert.deepEqual(outputs.map(o=>o.kind),['research','draft','review','draft','review']);
  assert.equal(outputs[2].verdict,'changes-requested');
  assert.equal(outputs[4].verdict,'ready-for-editor');
  assert.equal(outputs[3].references[0].text,'They departed in 1766.');
  const run=await scalar(db,'select row_to_json(r) from editorial_pipeline_runs r where id=$1',[runId]);
  assert.equal(run.state,'awaiting-editor');
  assert.equal(run.revision,1);
  assert.equal(await scalar(db,'select count(*)::int from editorial_pipeline_runs'),1);
  assert.equal(await scalar(db,'select count(*)::int from editorial_pipeline_tasks'),5);
  assert.equal(await scalar(db,'select count(*)::int from editorial_results'),5);
  assert.equal(await scalar(db,'select count(*)::int from editorial_chat_messages'),2);
  assert.equal(await scalar(db,`select editorial_claim('nothing-left',array['research','writer','reviewer'],120)`),null);
  assert.deepEqual((await db.query('select * from submissions')).rows,before);
 }finally{await db.close();}
});
