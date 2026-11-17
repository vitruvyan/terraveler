/** A worker-only MCP tool, deliberately absent from the public catalogue. */
import { timingSafeEqual } from "node:crypto";
import { dataRpc } from "@/lib/deskAuth";
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
export async function editorialMcpCorpus(args:unknown,header:string|null,env:Record<string,string|undefined>=process.env,rpc= dataRpc){
 const secret=env.EDITORIAL_MCP_CORPUS_KEY,worker=env.EDITORIAL_MCP_CORPUS_WORKER_ID;
 if(env.EDITORIAL_MCP_CORPUS_ENABLED!=="1"||!secret||secret.length<32||secret.length>512||!worker||worker.length>120)
  return {error:"corpus-unavailable"};
 if(!header||header.length>512)return {error:"corpus-unauthorized"};
 const actual=Buffer.from(header),expected=Buffer.from(secret);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return {error:"corpus-unauthorized"};
 if(!args||typeof args!=="object"||Array.isArray(args))return {error:"invalid-corpus-request"};
 const a=args as Record<string,unknown>;
 if(Object.keys(a).some(k=>!["task_id","attempt"].includes(k))||!positive(a.task_id)||!positive(a.attempt)||Number(a.attempt)>5)
  return {error:"invalid-corpus-request"};
 try{
  const result=await rpc("editorial_read_mcp_corpus",{p_task_id:a.task_id,p_attempt:a.attempt,p_worker:worker});
  if(result?.task_id!==a.task_id||result?.attempt!==a.attempt||!Array.isArray(result?.sources)||!result.sources.length||
   typeof result.consultation?.id!=="string"||! /^[a-f0-9]{64}$/.test(result.consultation?.snapshot_sha256??""))throw Error();
  return result;
 }catch{return {error:"corpus-unavailable"};}
}
