import test from "node:test";
import assert from "node:assert/strict";
import {readPublicCrewPreview,projectPublicCrewEvents} from "../lib/publicCrewPreview";
import type {PublicProject} from "../lib/editorialProjectBridge";
const now=Date.parse("2026-11-18T12:00:00Z");
const project={topic_id:1,gap_id:8,title:"A public expedition"} as PublicProject;
const registry=[{agent_key:"research",role:"research",specialty:"history",name:"PRIVATE",model:"SECRET"},{agent_key:"private",role:"research",specialty:"history"},{agent_key:"writer",role:"writer",specialty:"caption"}];
const task={id:6,topic_id:1,role:"research",state:"running",lease_expires_at:"2026-11-18T13:00:00Z",editorial_task_agents:{created_at:"2026-11-18T10:00:00Z",editorial_agent_versions:{agent_key:"research",role:"research",instructions:"SECRET"}},lease_token:"SECRET"};
const event=(id:number,kind:string,task_id=6,created_at="2026-11-18T11:00:00Z")=>({id,task_id,event:kind,created_at,detail:{secret:"SECRET"},worker:"PRIVATE"});
test("public profile projects only approved linked work, bound identity and safe events",async()=>{
 const reads:string[]=[];
 const data=await readPublicCrewPreview(async(_m,p)=>{reads.push(p);if(p.startsWith("editorial_specialist"))return registry;if(p.startsWith("editorial_tasks"))return [task,{...task,id:7,topic_id:99},{...task,id:9,editorial_task_agents:null}];if(p.startsWith("editorial_task_events"))return [event(1,"claimed"),event(2,"completed"),event(3,"failed"),event(4,"claimed",7),event(5,"claimed",6,"2026-11-18T09:00:00Z")];throw Error("unexpected");},async()=>({projects:[project],incomplete:false}),now);
 assert.deepEqual(data.profiles?.map(p=>p.key),["research"]);assert.equal(data.profiles?.[0].status,"assignment-recorded");
 assert.deepEqual(data.activity?.map(e=>e.kind),["candidate-recorded","assignment-started"]);assert.equal(data.profiles?.[0].current[0].id,8);
 assert.doesNotMatch(JSON.stringify(data),/SECRET|PRIVATE|lease_token|topic_id|instructions/);
 assert.ok(reads.every(p=>!p.includes("detail")&&!p.includes("model")&&!p.includes("lease_token")));
});
test("no public bridge means no internal task reads",async()=>{
 const data=await readPublicCrewPreview(async(_m,p)=>{assert.ok(p.startsWith("editorial_specialist"));return registry;},async()=>({projects:[],incomplete:false}),now);
 assert.equal(data.profiles?.[0].status,"no-current-public-assignment");assert.deepEqual(data.activity,[]);
});
test("failed bridge read is unavailable, not idle",async()=>{
 const data=await readPublicCrewPreview(async()=>registry,async()=>{throw Error("PRIVATE")},now);
 assert.equal(data.profiles?.[0].status,"unavailable");assert.equal(data.activity,null);assert.equal(data.incomplete,true);
});
