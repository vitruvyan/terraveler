import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL="editor@example.com";
process.env.POSTGREST_URL="https://data.invalid";
process.env.POSTGREST_SERVICE_KEY="fixture";
process.env.SUPABASE_AUTH_URL="https://auth.invalid";
process.env.SUPABASE_AUTH_KEY="fixture";
const sample=()=>({topic_id:1,submission_id:111,request_id:"bridge-request-0001",gap_id:null});
const gap={id:24,title:"Approved voyage",description:"Public brief",kind:"voyage",status:"open",claimed_by:null,claimed_at:null,source_submission_id:111,
 objective:"PRIVATE",lease_token:"SECRET",plan:{secret:true},result:{body:"PRIVATE DRAFT"}};
function fixture(path:string,revoked=false){
 if(path.startsWith("submissions?")) return revoked?[]:[{id:111}];
 if(path.startsWith("editorial_topic_submissions?"))return [{topic_id:1,submission_id:111}];
 if(path.startsWith("editorial_project_bridges?"))return [{topic_id:1,gap_id:24}];
 if(path.startsWith("editorial_gaps?"))return [gap];
 throw Error("Unexpected read");
}
test("bridge request is strict and only selects existing identities",async()=>{
 const {parseProjectBridgeRequest:parse,reconcileProject}=await import("../lib/editorialProjectBridge");
 assert.deepEqual(parse(sample()),sample());
 for(const patch of [{topic_id:0},{submission_id:1.2},{gap_id:"24"},{request_id:"short"},{title:"New lifecycle"},{approved:true}])assert.equal(parse({...sample(),...patch}),null);
 const {gap_id:_,...withoutGap}=sample();assert.deepEqual(parse(withoutGap),sample());
 await reconcileProject(sample(),async(name,args)=>{assert.equal(name,"editorial_reconcile_project");assert.deepEqual(args,{p_topic_id:1,p_submission_id:111,p_request_id:"bridge-request-0001",p_gap_id:null});return {gap_id:24};});
});
test("public project exposes an explicit whitelist and no execution/publication permission",async()=>{
 const {getPublicProject,getSubmissionProject}=await import("../lib/editorialProjectBridge");
 const read=async(_method:string,path:string)=>fixture(path);
 const project=await getPublicProject(24,read);assert.ok(project);
 assert.equal(project.topic_id,1);assert.equal(project.gap_id,24);assert.equal(project.publication,"not-established-by-work-state");
 assert.match(project.next_step,/only if eligible/);assert.equal(project.public_api,"https://www.terraveler.com/api/projects/24");
 assert.doesNotMatch(JSON.stringify(project),/PRIVATE|SECRET|objective|lease_token|allowed_actions|plan/);
 assert.deepEqual(await getSubmissionProject(111,read),project);
 assert.equal(await getPublicProject(24,async(_m,p)=>fixture(p,true)),null,"revoked origin is not public");
 assert.equal(await getSubmissionProject(111,async(_m,p)=>fixture(p,true)),null);
 assert.equal(await getSubmissionProject(111,async()=>[]),null);
 await assert.rejects(getSubmissionProject(111,async()=>{throw Error("migration unavailable");}),/migration unavailable/);
 await assert.rejects(getPublicProject(24,async()=>({})),"malformed backend is not an empty project");
});
test("private bridge route authenticates and validates before write; public route is read-only and redacted",async()=>{
 const {POST}=await import("../app/api/desk/projects/bridge/route");
 const {GET}=await import("../app/api/projects/[id]/route");
 const old=globalThis.fetch;let writes=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url.includes("/auth/v1/user"))return Response.json({email:"editor@example.com"});
  if(url.endsWith("/rpc/editorial_reconcile_project")){writes++;assert.equal(init?.method,"POST");return Response.json({gap_id:24,topic_id:1});}
  return Response.json(fixture(url.split("https://data.invalid/rest/v1/")[1]));
 };
 const req=(body:unknown,origin="http://local")=>new Request("http://local/api/desk/projects/bridge",{method:"POST",headers:{cookie:"desk_token=fixture",origin},body:JSON.stringify(body)});
 try{
  assert.equal((await POST(new Request("http://local/api/desk/projects/bridge",{method:"POST",body:JSON.stringify(sample())}))).status,401);
  assert.equal((await POST(req(sample(),"http://foreign"))).status,403);
  assert.equal((await POST(req({...sample(),state:"approved"}))).status,400);assert.equal(writes,0);
  const saved=await POST(req(sample()));assert.equal(saved.status,200);assert.equal(saved.headers.get("Cache-Control"),"private, no-store");assert.equal(writes,1);
  const publicReq=new Request("http://local/api/projects/24");
  const response=await GET(publicReq,{params:Promise.resolve({id:"24"})});assert.equal(response.status,200);assert.equal(response.headers.get("Cache-Control"),"no-store");assert.doesNotMatch(await response.text(),/PRIVATE|SECRET/);
  assert.equal((await GET(publicReq,{params:Promise.resolve({id:"1&select=*"})})).status,400);assert.equal(writes,1);
  globalThis.fetch=async()=>{throw Error("SECRET database diagnostics");};
  const failure=await GET(publicReq,{params:Promise.resolve({id:"24"})});assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/SECRET/);
 }finally{globalThis.fetch=old;}
});
