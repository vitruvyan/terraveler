import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { parsePreparationRequest, prepareEditorialPlan, PreparationError } from "@/lib/editorialPreparation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(req:Request){
  const auth=await requireEditor(req);if(!auth.ok)return reply({error:auth.error},401);
  const origin=req.headers.get("origin");if(origin&&origin!==new URL(req.url).origin)return reply({error:"invalid-origin"},403);
  if(Number(req.headers.get("content-length"))>8192)return reply({error:"request-too-large"},413);
  const raw=await req.text();if(Buffer.byteLength(raw)>8192)return reply({error:"request-too-large"},413);
  let body:unknown;try{body=JSON.parse(raw);}catch{return reply({error:"invalid-json"},400);}
  const input=parsePreparationRequest(body);if(!input)return reply({error:"invalid-preparation-request"},400);
  try{return reply(await prepareEditorialPlan(input));}
  catch(e){
    if(e instanceof PreparationError)return reply({error:e.code,...(e.candidates.length?{candidates:e.candidates}:{})},
      e.code==="topic-not-found"?404:e.code.includes("selection")||e.code.includes("conflict")||e.code.includes("insufficient")||e.code==="orientation-not-found"?409:503);
    return reply({error:"preparation-unavailable"},503);
  }
}
