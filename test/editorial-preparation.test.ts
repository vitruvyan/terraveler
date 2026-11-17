import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL="editor@example.com";
process.env.POSTGREST_URL="https://data.invalid";
process.env.POSTGREST_SERVICE_KEY="fixture";
process.env.SUPABASE_AUTH_URL="https://auth.invalid";
process.env.SUPABASE_AUTH_KEY="fixture";
const mod=import("../lib/editorialPreparation");
const url="https://en.wikipedia.org/wiki/Example", id="00000000-0000-4000-8000-000000000001";
const request={topic_id:1,expected_version:0,request_id:"preparation-request-0001",wikipedia_url:null};
const orientation={kind:"wikipedia-orientation",purpose:"planning-only",revision_id:12,text:"Test text",sections:[{title:"Itinerary"}],text_truncated:false,sections_truncated:false,external_links_truncated:false};
const review={verdict:"adequate-for-next-stage",issues:[]};
const work={gaps:["Indigenous perspectives"],work_items:[{id:"history",question:"What happened?",deliverable:"Cited chronology",specialty:"history",depends_on:[],source_receipt_ids:[]}]};
function fixture(){
 const calls:string[]=[];let writes=0;
 const read=async(_method:string,path:string)=>{
  if(path.startsWith("editorial_plan_preparations?")||path.startsWith("editorial_plans?"))return [];
  if(path.startsWith("editorial_topics?"))return [{id:1,title:"Example",objective:"Research"}];
  if(path.startsWith("editorial_agents_current?"))return [
   {id:1,agent_key:"planner",version:1,role:"coordinator",model:"local",instructions:"Plan",enabled:true},
   {id:2,agent_key:"reviewer",version:1,role:"reviewer",model:"local",instructions:"Review",enabled:true}];
  if(path.startsWith("editorial_mcp_consultations?"))return [{id,tool:"get_wikipedia_outline",arguments:{url},response:orientation,response_sha256:"a".repeat(64)}];
  throw Error("unexpected read");
 };
 return {calls, get writes(){return writes;}, ports:{env:{EDITORIAL_PREPARATION_ENABLED:"1"},read,rpc:async(name:string,args:Record<string,unknown>)=>{
  writes++;calls.push(name);assert.equal(name,"editorial_record_preparation");assert.equal(args.p_planner_version_id,1);assert.equal(args.p_reviewer_version_id,2);assert.deepEqual(args.p_review,review);return {plan_id:1,review,replayed:false};
 },mcp:async(name:string)=>{calls.push(name);return name==="search_sources"?{candidates:[{kind:"wikipedia",title:"Example",url}]}:{consultation_status:"recorded",consultation:{id,response_sha256:"a".repeat(64)}};},
 generate:async(agent:{id:number},stage:string,material:unknown)=>{calls.push(stage);if(stage==="review"){assert.equal(agent.id,2);assert.deepEqual((material as any).plan.orientation_receipt_id,id);return review;}assert.equal(agent.id,1);return work;}}};
}
test("preparation runs MCP before the two distinct agents and persists no authority to execute",async()=>{
 const {prepareEditorialPlan}=await mod;const f=fixture();
 assert.equal((await prepareEditorialPlan(request,f.ports)).plan_id,1);
 assert.deepEqual(f.calls,["search_sources","get_wikipedia_outline","plan","review","editorial_record_preparation"]);
});
test("missing receipt and fabricated source IDs cannot reach persistence",async()=>{
 const {prepareEditorialPlan}=await mod;
 const a=fixture();await assert.rejects(prepareEditorialPlan({...request,wikipedia_url:url},{...a.ports,mcp:async()=>({consultation_status:"disabled"})}),/orientation-receipt-required/);assert.equal(a.writes,0);
 const b=fixture();await assert.rejects(prepareEditorialPlan(request,{...b.ports,generate:async()=>({...work,work_items:[{...work.work_items[0],source_receipt_ids:[id]}]})}),/plan-generation-invalid/);assert.equal(b.writes,0);
});
test("ambiguous orientation and malformed review fail closed",async()=>{
 const {selectOrientation,parsePlanReview,parsePreparationRequest}=await mod;
 assert.throws(()=>selectOrientation("Example",{candidates:[{kind:"wikipedia",title:"Other",url}]}),/orientation-selection-required/);
 assert.throws(()=>parsePlanReview({verdict:"adequate-for-next-stage",issues:["Problem"]}),/plan-review-invalid/);
 assert.equal(parsePreparationRequest({...request,wikipedia_url:"https://evil.example/wiki/Test"}),null);
 assert.equal(parsePreparationRequest({...request,review}),null);
});
test("disabled preparation performs no source or model call",async()=>{
 const {prepareEditorialPlan}=await mod;const f=fixture();
 await assert.rejects(prepareEditorialPlan(request,{...f.ports,env:{}}),/preparation-disabled/);assert.equal(f.calls.length,0);
});

test("model transport accepts only standalone JSON or a single fenced JSON value",async()=>{
 const {parsePreparationModelResponse}=await mod;
 const envelope=(content:unknown,finish_reason="stop")=>({choices:[{message:{content},finish_reason}]});
 assert.deepEqual(parsePreparationModelResponse(envelope(JSON.stringify(work)),"plan"),work);
 assert.deepEqual(parsePreparationModelResponse(envelope("\x60\x60\x60json\n"+JSON.stringify(work)+"\n\x60\x60\x60"),"plan"),work);
 for(const [v,detail] of [[envelope(""),"empty-content"],[envelope("preface "+JSON.stringify(work)),"invalid-json"],[envelope("{","length"),"output-truncated"],[{},"missing-choice"]] as const){
  assert.throws(()=>parsePreparationModelResponse(v,"plan"),(e:any)=>e.code==="plan-generation-invalid"&&e.detail===detail);
 }
 assert.deepEqual(parsePreparationModelResponse(envelope(JSON.stringify(review)),"review"),review);
});
test("malformed planner schema cannot reach reviewer or database",async()=>{
 const {prepareEditorialPlan}=await mod;const f=fixture();
 await assert.rejects(prepareEditorialPlan(request,{...f.ports,generate:async()=>({gaps:[],work_items:[{...work.work_items[0],depends_on:["missing"]}]})}),(e:any)=>e.code==="plan-generation-invalid"&&e.detail==="invalid-plan-schema-or-dependencies");
 assert.equal(f.writes,0);
});

test("preparation preserves safe truncation diagnostics even when truncated JSON parses",async()=>{
 const {prepareEditorialPlan}=await mod;const f=fixture();
 const {generate:_generate,...ports}=f.ports;
 const env={...ports.env,EDITOR_LIMEN_MODEL:"local",EDITOR_LIMEN_BASE_URL:"https://gateway.example/v1",
  EDITOR_LIMEN_API_KEY:"fixture-key",EDITOR_LIMEN_DATA_CLASS:"editorial"};
 let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(String(init?.body));assert.equal(body.max_tokens,5000);
  return Response.json({choices:[{finish_reason:"length",message:{content:JSON.stringify(work)}}]});
 };
 await assert.rejects(prepareEditorialPlan(request,{...ports,env,fetcher}),
  (e:any)=>e.code==="plan-generation-invalid"&&e.detail==="output-truncated");
 assert.equal(calls,1);assert.equal(f.writes,0);
});

test("preparation reserves two bounded generation calls within its function duration",async()=>{
 const {prepareEditorialPlan}=await mod;const f=fixture();
 const {generate:_generate,...ports}=f.ports;
 const env={...ports.env,EDITOR_LIMEN_MODEL:"local",EDITOR_LIMEN_BASE_URL:"https://gateway.example/v1",
  EDITOR_LIMEN_API_KEY:"fixture-key",EDITOR_LIMEN_DATA_CLASS:"editorial"};
 const oldSetTimeout=globalThis.setTimeout,delays:number[]=[];
 globalThis.setTimeout=((callback:any,delay:number,...args:any[])=>{
  delays.push(delay);return oldSetTimeout(callback,delay,...args);
 }) as typeof setTimeout;
 let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.equal(body.max_tokens,5000);
  assert.ok(init?.signal);assert.equal(init?.redirect,"error");
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(calls++===0?work:review)}}]});
 };
 try{
  assert.equal((await prepareEditorialPlan(request,{...ports,env,fetcher})).plan_id,1);
  assert.deepEqual(delays,[100000,100000]);assert.equal(calls,2);assert.equal(f.writes,1);
 }finally{globalThis.setTimeout=oldSetTimeout;}
 const {maxDuration}=await import("../app/api/desk/projects/prepare/route");
 assert.equal(maxDuration,300);
 assert.ok(delays.reduce((sum,delay)=>sum+delay,0)+40000<maxDuration*1000);
});
