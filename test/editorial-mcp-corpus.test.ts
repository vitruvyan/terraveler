import test from "node:test";
import assert from "node:assert/strict";
process.env.POSTGREST_URL="https://data.invalid";
process.env.POSTGREST_SERVICE_KEY="fixture";
const mod=import("../lib/editorialMcpCorpus");
test("internal corpus MCP requires worker-only key and exact task attempt",async()=>{
 const {editorialMcpCorpus}=await mod;
 const key="a".repeat(40),env={EDITORIAL_MCP_CORPUS_ENABLED:"1",EDITORIAL_MCP_CORPUS_KEY:key,EDITORIAL_MCP_CORPUS_WORKER_ID:"worker-1"};
 let calls=0;const rpc=async(name:string,args:Record<string,unknown>)=>{
  calls++;assert.equal(name,"editorial_read_mcp_corpus");assert.deepEqual(args,{p_task_id:12,p_attempt:1,p_worker:"worker-1"});
  return {task_id:12,attempt:1,sources:[{id:"rag:1"}],consultation:{id:"receipt",snapshot_sha256:"b".repeat(64)}};
 };
 for(const wrong of [null,"incorrect", "b".repeat(40)])assert.equal((await editorialMcpCorpus({task_id:12,attempt:1},wrong,env,rpc)).error,"corpus-unauthorized");
 assert.equal((await editorialMcpCorpus({task_id:12,attempt:1,scope:["all"]},key,env,rpc)).error,"invalid-corpus-request");
 assert.equal((await editorialMcpCorpus({task_id:12,attempt:1},key,{},rpc)).error,"corpus-unavailable");
 assert.equal(calls,0);
 assert.equal((await editorialMcpCorpus({task_id:12,attempt:1},key,env,rpc)).task_id,12);
 assert.equal(calls,1);
});
