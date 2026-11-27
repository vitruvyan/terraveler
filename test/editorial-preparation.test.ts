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
const work={gaps:["Indigenous perspectives"],research_items:[{id:"history",question:"What happened?",deliverable:"Cited chronology",specialty:"history"},{id:"peoples",question:"Who hosted the survivors?",deliverable:"Cited perspectives",specialty:"ethnohistory"},{id:"route",question:"Which route?",deliverable:"Waypoint candidates",specialty:"itinerary"}]};
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
 generate:async(agent:{id:number},stage:string,material:unknown)=>{calls.push(stage);if(stage==="review"){
  const plan=(material as any).plan;assert.equal(agent.id,2);assert.equal(plan.orientation_receipt_id,id);
  assert.deepEqual(plan.work_items.map((item:any)=>item.specialty),["history","ethnohistory","itinerary","diary","editorial","copyedit","factcheck","copyedit","factcheck"]);
  assert.deepEqual(plan.work_items[3].depends_on,["history","peoples","route"]);assert.deepEqual(plan.work_items[4].depends_on,["history","peoples","route"]);
  assert.deepEqual(plan.work_items[5].depends_on,["diary"]);assert.deepEqual(plan.work_items[7].depends_on,["editorial"]);return review;
 }assert.equal(agent.id,1);return work;}}};
}
test("preparation runs MCP before the two distinct agents and persists no authority to execute",async()=>{
 const {prepareEditorialPlan}=await mod;const f=fixture();
 assert.equal((await prepareEditorialPlan(request,f.ports)).plan_id,1);
 assert.deepEqual(f.calls,["search_sources","get_wikipedia_outline","plan","review","editorial_record_preparation"]);
});
test("missing receipt and fabricated source IDs cannot reach persistence",async()=>{
 const {prepareEditorialPlan}=await mod;
 const a=fixture();await assert.rejects(prepareEditorialPlan({...request,wikipedia_url:url},{...a.ports,mcp:async()=>({consultation_status:"disabled"})}),/orientation-receipt-required/);assert.equal(a.writes,0);
 const b=fixture();await assert.rejects(prepareEditorialPlan(request,{...b.ports,generate:async()=>({...work,research_items:[{...work.research_items[0],source_receipt_ids:[id]}]})}),/plan-generation-invalid/);assert.equal(b.writes,0);
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

test("MCP envelope failures expose only bounded diagnostic categories",async()=>{
 const {prepareEditorialPlan}=await mod;
 const cases=[
  [{jsonrpc:"1.0",id:1,error:{message:"PRIVATE"}},"mcp-protocol-invalid"],
  [{jsonrpc:"2.0",id:2,error:{message:"PRIVATE"}},"mcp-protocol-invalid"],
  [{jsonrpc:"2.0",id:1,error:{message:"PRIVATE"}},"mcp-rpc-error"],
  [{jsonrpc:"2.0",id:1,result:{isError:true,content:[{type:"text",text:"PRIVATE"}]}},"mcp-tool-error"],
  [{jsonrpc:"2.0",id:1,result:{isError:false,content:[{type:"text",text:"PRIVATE"}]}},"mcp-structured-content-required"],
 ] as const;
 for(const [envelope,detail] of cases){
  const f=fixture(),events:any[]=[],{mcp:_mcp,...ports}=f.ports;
  await assert.rejects(prepareEditorialPlan({...request,wikipedia_url:url},{...ports,
   env:{...ports.env,EDITORIAL_MCP_URL:"https://www.terraveler.com/api/mcp"},
   fetcher:async()=>Response.json(envelope),observe:e=>events.push(e)}),
   (e:any)=>e.code==="mcp-unavailable"&&e.stage==="orientation-read"&&e.detail===detail&&!String(e).includes("PRIVATE"));
  assert.equal(f.writes,0);assert.equal(f.calls.length,0);
  assert.ok(!events.some(e=>e.stage==="planner"||e.stage==="persist"));
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE/);
 }
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
 await assert.rejects(prepareEditorialPlan(request,{...f.ports,generate:async()=>({gaps:[],research_items:[{...work.research_items[0],id:"INVALID ID"},work.research_items[1],work.research_items[2]]})}),(e:any)=>e.code==="plan-generation-invalid"&&e.detail==="invalid-plan-schema-or-dependencies");
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
  assert.deepEqual(delays,[90000,160000]);assert.equal(calls,2);assert.equal(f.writes,1);
 }finally{globalThis.setTimeout=oldSetTimeout;}
 const {maxDuration}=await import("../app/api/desk/projects/prepare/route");
 assert.equal(maxDuration,300);
 assert.ok(delays.reduce((sum,delay)=>sum+delay,0)+40000<maxDuration*1000);
});

test("preparation emits correlated stages and isolates validation failure before review/persistence",async()=>{
 const {prepareEditorialPlan}=await mod,f=fixture(),events:any[]=[],attemptId="00000000-0000-4000-8000-000000000099";
 await assert.rejects(prepareEditorialPlan(request,{...f.ports,attemptId,observe:e=>events.push(e),generate:async()=>({gaps:[],research_items:[]})}),
  (e:any)=>e.stage==="plan-validation"&&e.correlation_id===attemptId&&e.code==="plan-generation-invalid");
 assert.equal(f.writes,0);assert.equal(events.at(-1).stage,"plan-validation");assert.equal(events.at(-1).status,"failed");
 assert.ok(events.every(e=>e.correlation_id===attemptId&&e.request_id===request.request_id&&e.topic_id===1));
 assert.ok(!events.some(e=>e.stage==="reviewer"||e.stage==="persist"));
 assert.doesNotMatch(JSON.stringify(events),/Test text|Research|Plan|Review|https:/);
});

test("preparation identifies reviewer output failure independently of successful planning",async()=>{
 const {prepareEditorialPlan}=await mod,f=fixture(),events:any[]=[];
 await assert.rejects(prepareEditorialPlan(request,{...f.ports,observe:e=>events.push(e),generate:async(_agent,stage)=>stage==="plan"?work:{verdict:"adequate-for-next-stage",issues:["unresolved"]}}),
  (e:any)=>e.stage==="review-validation"&&e.code==="plan-review-invalid");
 assert.equal(f.writes,0);assert.equal(events.at(-1).stage,"review-validation");
});

test("persistence diagnostics never expose database bodies and observers cannot change acceptance",async()=>{
 const {prepareEditorialPlan}=await mod;
 const f=fixture();assert.equal((await prepareEditorialPlan(request,{...f.ports,observe:()=>{throw Error("logger unavailable");}})).plan_id,1);
 const a=fixture();await assert.rejects(prepareEditorialPlan(request,{...a.ports,rpc:async()=>{throw Error("PRIVATE PASSWORD database-write");}}),
  (e:any)=>e.stage==="persist"&&e.code==="preparation-persistence-failed"&&e.detail==="database-write-failed"&&!String(e).includes("PRIVATE"));
 const b=fixture();await assert.rejects(prepareEditorialPlan(request,{...b.ports,rpc:async()=>{throw Error("preparation agent changed or paused; PRIVATE KEY");}}),
  (e:any)=>e.stage==="persist"&&e.code==="preparation-persistence-failed"&&e.detail==="preparation-agent-changed-or-paused");
});

test("real transport diagnostics capture only response metadata and prompts contain valid JSON examples",async()=>{
 const {prepareEditorialPlan}=await mod,f=fixture(),events:any[]=[];
 const {generate:_generate,...ports}=f.ports;
 const env={...ports.env,EDITOR_LIMEN_MODEL:"local",EDITOR_LIMEN_BASE_URL:"https://gateway.example/v1",
  EDITOR_LIMEN_API_KEY:"PRIVATE-AUTHORIZATION",EDITOR_LIMEN_DATA_CLASS:"editorial"};
 let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  assert.ok(!body.messages[0].content.includes('"specialty":"history|'));
  assert.ok(!body.messages[0].content.includes('"verdict":"adequate-for-next-stage|'));
  return Response.json({model:"gemma4:26b-mlx",choices:[{finish_reason:"stop",message:{content:JSON.stringify(calls++===0?work:review)}}]},
   {headers:{"x-request-id":"limen-fixture-request-1","x-private-key":"PRIVATE-HEADER"}});
 };
 assert.equal((await prepareEditorialPlan(request,{...ports,env,fetcher,observe:e=>events.push(e)})).plan_id,1);
 const models=events.filter(e=>e.status==="model-response");assert.equal(models.length,2);
 assert.equal(models[0].stage,"planner");assert.equal(models[1].stage,"reviewer");
 for(const e of models){assert.equal(e.http_status,200);assert.equal(e.requested_model,"local");assert.equal(e.response_reported_model,"gemma4:26b-mlx");assert.equal(e.response_request_id,"limen-fixture-request-1");assert.match(e.output_sha256,/^[a-f0-9]{64}$/);assert.ok(e.output_chars>0);}
 assert.doesNotMatch(JSON.stringify(events),/PRIVATE|unanswered|What happened|Cited chronology|Test text|source_receipt_ids/);
});

test("transport failures report safe status at the model stage without accepting HTTP success as valid output",async()=>{
 const {prepareEditorialPlan}=await mod,f=fixture();
 const {generate:_generate,...ports}=f.ports;
 const env={...ports.env,EDITOR_LIMEN_MODEL:"local",EDITOR_LIMEN_BASE_URL:"https://gateway.example/v1",EDITOR_LIMEN_API_KEY:"fixture-key",EDITOR_LIMEN_DATA_CLASS:"editorial"};
 await assert.rejects(prepareEditorialPlan(request,{...ports,env,fetcher:async()=>new Response("PRIVATE PROVIDER BODY",{status:429})}),
  (e:any)=>e.stage==="planner"&&e.code==="limen-unavailable"&&e.detail==="http-429");
 assert.equal(f.writes,0);
 await assert.rejects(prepareEditorialPlan(request,{...ports,env,fetcher:async()=>Response.json({model:"local",choices:[{finish_reason:"stop",message:{content:"{bad JSON"}}]})}),
  (e:any)=>e.stage==="planner"&&e.code==="plan-generation-invalid"&&e.detail==="invalid-json");
 assert.equal(f.writes,0);
});

test("private preparation API returns server-generated correlation and stage without raw logs",async()=>{
 const {POST}=await import("../app/api/desk/projects/prepare/route");
 const oldFetch=globalThis.fetch,oldLog=console.info,oldFlag=process.env.EDITORIAL_PREPARATION_ENABLED,logs:string[]=[];
 delete process.env.EDITORIAL_PREPARATION_ENABLED;
 globalThis.fetch=async()=>Response.json({email:"editor@example.com"});console.info=(line:string)=>{logs.push(line);};
 try{
  const res=await POST(new Request("https://www.terraveler.com/api/desk/projects/prepare",{method:"POST",headers:{cookie:"desk_token=fixture",origin:"https://www.terraveler.com","x-request-id":"attacker-selected"},body:JSON.stringify(request)}));
  const body=await res.json();assert.equal(body.error,"preparation-disabled");assert.equal(body.stage,"preflight");
  assert.match(body.correlation_id,/^[a-f0-9-]{36}$/);assert.notEqual(body.correlation_id,"attacker-selected");
  assert.equal(res.headers.get("cache-control"),"private, no-store");
  assert.equal(JSON.parse(logs.at(-1)!).correlation_id,body.correlation_id);
 }finally{globalThis.fetch=oldFetch;console.info=oldLog;if(oldFlag===undefined)delete process.env.EDITORIAL_PREPARATION_ENABLED;else process.env.EDITORIAL_PREPARATION_ENABLED=oldFlag;}
});

test("preparation requests JSON mode through Limen for both agents without format fallback",async()=>{
 const {prepareEditorialPlan}=await mod;
 for(const failReview of [false,true]){
  const f=fixture(),{generate:_generate,...ports}=f.ports;
  const env={...ports.env,EDITOR_LIMEN_MODEL:"local",EDITOR_LIMEN_BASE_URL:"https://gateway.example/v1",EDITOR_LIMEN_API_KEY:"fixture-key",EDITOR_LIMEN_DATA_CLASS:"editorial"};
  let calls=0;
  const fetcher:typeof fetch=async(endpoint,init)=>{
   assert.equal(String(endpoint),"https://gateway.example/v1/chat/completions");
   const body=JSON.parse(String(init?.body));
   assert.equal(body.response_format.type,"json_schema");assert.equal(body.response_format.json_schema.strict,true);
   assert.equal(body.response_format.json_schema.schema.additionalProperties,false);assert.equal(body.model,"local");
   assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes("maxLength"),false);
   if(calls===0){
    const schema=body.response_format.json_schema.schema;
    assert.equal(body.response_format.json_schema.name,"terraveler_editorial_research_plan");
    assert.deepEqual(schema.properties.research_items.items.properties.specialty.enum,["history","ethnohistory","itinerary"]);
    assert.equal(schema.properties.research_items.items.additionalProperties,false);
    assert.equal(schema.properties.research_items.minItems,3);assert.equal(schema.properties.research_items.maxItems,4);
   }else assert.equal(body.response_format.json_schema.name,"terraveler_editorial_plan_review");
   assert.equal((init?.headers as Record<string,string>)["Authorization"],"Bearer fixture-key");
   const stage=calls++;
   if(stage===1&&failReview)return Response.json({error:"PRIVATE PROVIDER BODY"},{status:400});
   return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(stage===0?work:review)}}]});
  };
  if(failReview)await assert.rejects(prepareEditorialPlan(request,{...ports,env,fetcher}),
   (e:any)=>e.code==="limen-unavailable"&&e.stage==="reviewer"&&e.detail==="http-400"&&!String(e).includes("PRIVATE"));
  else assert.equal((await prepareEditorialPlan(request,{...ports,env,fetcher})).plan_id,1);
  assert.equal(calls,2);assert.equal(f.writes,failReview?0:1);
 }
});

const storedPlan={gaps:["Indigenous perspectives"],orientation_receipt_id:id,work_items:[{id:"history-1",question:"What happened?",deliverable:"Cited chronology",specialty:"history",depends_on:[],source_receipt_ids:[]}]};
const prevReview={verdict:"changes-requested",issues:["Cover Estebanico explicitly"]};
function guidedFixture(missingReview=false){
 const calls:string[]=[];let writes=0;const materials:Record<string,any>={};
 const read=async(_method:string,path:string)=>{
  if(path.startsWith("editorial_plan_preparations?request_id="))return [];
  if(path.startsWith("editorial_plan_preparations?plan_id="))return missingReview?[]:[{review:prevReview}];
  if(path.startsWith("editorial_plans?")&&path.includes("select=id,version,plan"))return [{id:1,version:1,plan:storedPlan}];
  if(path.startsWith("editorial_plans?")&&path.includes("select=version"))return [{version:1}];
  if(path.startsWith("editorial_topics?"))return [{id:1,title:"Example",objective:"Research"}];
  if(path.startsWith("editorial_agents_current?"))return [
   {id:1,agent_key:"planner",version:1,role:"coordinator",model:"local",instructions:"Plan",enabled:true},
   {id:2,agent_key:"reviewer",version:1,role:"reviewer",model:"local",instructions:"Review",enabled:true}];
  if(path.startsWith("editorial_mcp_consultations?"))return [{id,tool:"get_wikipedia_outline",arguments:{url},response:orientation,response_sha256:"a".repeat(64)}];
  throw Error("unexpected read");
 };
 return {calls,materials,get writes(){return writes;},ports:{env:{EDITORIAL_PREPARATION_ENABLED:"1"},read,rpc:async(name:string,args:Record<string,unknown>)=>{
  writes++;assert.equal(name,"editorial_record_preparation");assert.equal(args.p_expected_version,1);return {plan_id:2,review,replayed:false};
 },mcp:async(name:string)=>{calls.push(name);return name==="search_sources"?{candidates:[{kind:"wikipedia",title:"Example",url}]}:{consultation_status:"recorded",consultation:{id,response_sha256:"a".repeat(64)}};},
 generate:async(agent:{id:number},stage:string,material:unknown)=>{materials[stage]=material;if(stage==="review")return review;return work;}}};
}
const guidedRequest={...request,expected_version:1,request_id:"preparation-request-0002"};

test("guided iteration supplies the previous plan and review to planner and reviewer",async()=>{
 const {prepareEditorialPlan}=await mod;const f=guidedFixture();const events:any[]=[];
 assert.equal((await prepareEditorialPlan(guidedRequest,{...f.ports,observe:e=>events.push(e)})).plan_id,2);
 assert.equal(f.writes,1);
 assert.deepEqual(f.materials.plan.previous_review,prevReview);
 assert.deepEqual(f.materials.plan.previous_plan,storedPlan);
 assert.equal(f.materials.plan.previous_plan_version,1);
 assert.deepEqual(f.materials.review.previous_review,prevReview);
 assert.deepEqual(f.materials.review.plan.orientation_receipt_id,id);
 assert.ok(events.some(e=>e.stage==="previous-review"&&e.status==="completed"));
 assert.doesNotMatch(JSON.stringify(events),/Estebanico|What happened|Cited chronology/);
});

test("guided iteration fails closed when the previous plan or its review is missing",async()=>{
 const {prepareEditorialPlan}=await mod;
 const a=guidedFixture(true);
 await assert.rejects(prepareEditorialPlan(guidedRequest,a.ports),(e:any)=>e.stage==="previous-review"&&e.code==="preparation-unavailable");
 assert.equal(a.writes,0);assert.equal(a.materials.plan,undefined);
});

test("first-version preparation never fabricates previous-review context",async()=>{
 const {prepareEditorialPlan}=await mod;const f=fixture();const materials:Record<string,any>={};
 const generate=async(_agent:{id:number},stage:string,material:unknown)=>{materials[stage]=material;return stage==="review"?review:work;};
 assert.equal((await prepareEditorialPlan(request,{...f.ports,generate})).plan_id,1);
 assert.ok(!("previous_review" in materials.plan)&&!("previous_plan" in materials.plan));
 assert.ok(!("previous_review" in materials.review));
});

test("plan composition requires history, ethnohistory and exactly one itinerary research item", async()=>{
  const {composeEditorialPlan}=await mod;
  const item=(id:string,specialty:string)=>({id,question:"Where?",deliverable:"Route",specialty});
  const h=item("hist-a","history"),e=item("peoples-a","ethnohistory"),i=item("route-a","itinerary");
  for(const items of [[h,e],[h,i,item("hist-b","history")],[e,i,item("peoples-b","ethnohistory")],[h,e,i,item("route-b","itinerary")]])
    assert.equal(composeEditorialPlan({gaps:[],research_items:items}),null);
  const plan=composeEditorialPlan({gaps:[],research_items:[h,e,i,item("hist-b","history")]});
  assert.ok(plan);
  assert.deepEqual(plan.work_items.filter((w:any)=>w.depends_on.length===0).map((w:any)=>w.specialty),["history","ethnohistory","itinerary","history"]);
});
