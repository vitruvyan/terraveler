import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { dispatchPlan,parseDispatchRequest,readGraphStatus } from "@/lib/editorialDispatch";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(req:Request){
 const auth=await requireEditor(req);if(!auth.ok)return reply({error:auth.error},401);
 const q=new URL(req.url).searchParams,raw=q.get("topic_id");
 if(!raw||!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw))||[...q.keys()].some(k=>k!=="topic_id"))return reply({error:"invalid-topic"},400);
 try{return reply({runs:await readGraphStatus(Number(raw))});}catch{return reply({error:"graph-unavailable"},503);}
}
export async function POST(req:Request){
 const auth=await requireEditor(req);if(!auth.ok)return reply({error:auth.error},401);
 const origin=req.headers.get("origin");if(origin&&origin!==new URL(req.url).origin)return reply({error:"invalid-origin"},403);
 if(process.env.EDITORIAL_PLAN_DISPATCH_ENABLED!=="1"||process.env.EDITORIAL_MCP_CORPUS_ENABLED!=="1")return reply({error:"dispatch-disabled"},503);
 if(Number(req.headers.get("content-length"))>8192)return reply({error:"request-too-large"},413);
 const raw=await req.text();if(Buffer.byteLength(raw)>8192)return reply({error:"request-too-large"},413);
 let value:unknown;try{value=JSON.parse(raw);}catch{return reply({error:"invalid-json"},400);}
 const input=parseDispatchRequest(value);if(!input)return reply({error:"invalid-dispatch"},400);
 try{return reply(await dispatchPlan(input));}catch(e){
  const message=e instanceof Error?e.message:"";
  const reasons=["independently reviewed plan required","stale plan version","plan already dispatched","active work must be resolved","approved voyage corpus scope required","specialist handler not implemented","unique enabled specialist required","unsupported editorial dependency graph","research items required","one writer and one reviewer required","dispatch idempotency conflict"];
  const reason=reasons.find(r=>message.includes(r));
  return reply({error:reason??"dispatch-unavailable"},reason?409:503);
 }
}
