import test from "node:test";
import assert from "node:assert/strict";
import {readPublicExpeditions} from "../lib/chartroomPreview";
test("public expeditions reuse canonical approval and membership checks; private extras never cross the projection",async()=>{
 const read=async(_method:string,path:string)=>{
  if(path.startsWith("editorial_project_bridges?select="))return [{gap_id:1},{gap_id:2},{gap_id:3},{gap_id:4}];
  if(path.startsWith("editorial_project_bridges?gap_id=eq.")){const gap=Number(path.match(/gap_id=eq\.(\d+)/)?.[1]);return [{gap_id:gap,topic_id:gap+10,private:"SECRET"}];}
  if(path.startsWith("editorial_gaps?")){const gap=Number(path.match(/id=eq\.(\d+)/)?.[1]);if(gap===4)throw Error("PRIVATE");return [{id:gap,title:"Expedition "+gap,description:"Public description",kind:"voyage",status:"open",source_submission_id:gap+20,objective:"SECRET"}];}
  if(path.startsWith("submissions?"))return path.includes("id=eq.22&")?[]:[{id:1}];
  if(path.startsWith("editorial_topic_submissions?"))return path.includes("submission_id=eq.23&")?[]:[{submission_id:21}];
  throw Error("Unexpected read");
 };
 const result=await readPublicExpeditions(read);
 assert.equal(result.incomplete,true);assert.deepEqual(result.projects.map(p=>p.gap_id),[1]);
 assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE|topic_id|objective|source_submission_id/);
});
test("empty bridge list and read failure are different outcomes",async()=>{
 const empty=await readPublicExpeditions(async()=>[]);assert.deepEqual(empty.projects,[]);assert.equal(empty.incomplete,false);
 await assert.rejects(()=>readPublicExpeditions(async()=>{throw Error("offline");}));
});
test("invalid bridge ids fail closed",async()=>{
 await assert.rejects(()=>readPublicExpeditions(async()=>[{gap_id:"1"}]));
});
