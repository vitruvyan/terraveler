import test from "node:test";
import assert from "node:assert/strict";
import {newsroomPreviewEnabled,projectTask,projectEvents,readNewsroomPreview} from "../lib/newsroomPreview";
test("preview is never accessible in production even with NODE_ENV production",()=>{
 assert.equal(newsroomPreviewEnabled({VERCEL_ENV:"production",NODE_ENV:"production"}),false);
 assert.equal(newsroomPreviewEnabled({VERCEL_ENV:"preview",NODE_ENV:"production"}),true);
 assert.equal(newsroomPreviewEnabled({NODE_ENV:"development"}),true);
});
test("event projection excludes raw details, workers and leases; unknown event kinds omitted",()=>{
 const task=projectTask({id:1,topic_id:2,role:"research",state:"running",attempt:1,editorial_task_agents:{editorial_agent_versions:{agent_key:"historian",version:2,instructions:"PRIVATE"}},lease_token:"SECRET"},true)!;
 const records=[{id:8,task_id:1,event:"claimed",attempt:1,created_at:"2026-11-17T00:00:00Z",detail:{lease_token:"SECRET"},worker:"PRIVATE"},{id:9,task_id:1,event:"SECRET",attempt:1,created_at:"2026-11-17T00:00:01Z"}];
 const events=projectEvents(records,[task]);assert.equal(events.length,1);assert.equal(events[0].agent_key,"historian");assert.equal(events[0].bound_version,2);assert.doesNotMatch(JSON.stringify({events,task}),/PRIVATE|SECRET|lease_token/);
});
test("historical event identity is not inferred from an unbound current assignment",()=>{
 const row={id:1,topic_id:2,role:"research",state:"queued",attempt:0,editorial_specialist_assignments:{agent_key:"historian"}};
 assert.equal(projectTask(row)?.agent_key,"historian");assert.equal(projectTask(row,true)?.agent_key,null);
});
test("failed reads are unavailable, independent empty sections remain empty",async()=>{
 const paths:string[]=[];
 const result=await readNewsroomPreview(async(_method,path)=>{paths.push(path);if(path.startsWith("editorial_task_events"))throw Error("PRIVATE");return [];},async()=>{throw Error("PRIVATE");});
 assert.equal(result.dashboard,null);assert.equal(result.events,null);assert.deepEqual(result.agents,[]);assert.deepEqual(result.ideas,[]);assert.deepEqual(result.errors,["Briefing","Task events"]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 const eventPath=paths.find(p=>p.startsWith("editorial_task_events"))!;assert.ok(!eventPath.includes("detail")&&!eventPath.includes("worker"));
});
test("anonymous request is denied before reading records; production route is closed",async()=>{
 const {GET}=await import("../app/api/desk/newsroom-preview/route");
 const prior=process.env.VERCEL_ENV;const oldNode=process.env.NODE_ENV;
 try{
  process.env.VERCEL_ENV="preview";
  const anon=await GET(new Request("https://site.invalid/api/desk/newsroom-preview"));assert.equal(anon.status,401);assert.match(anon.headers.get("cache-control")??"",/private, no-store/);
  process.env.VERCEL_ENV="production";Object.assign(process.env,{NODE_ENV:"production"});
  const closed=await GET(new Request("https://site.invalid/api/desk/newsroom-preview"));assert.equal(closed.status,404);
 }finally{if(prior===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prior;if(oldNode===undefined)Reflect.deleteProperty(process.env,"NODE_ENV");else Object.assign(process.env,{NODE_ENV:oldNode});}
});
