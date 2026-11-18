import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { attachDossierSource,parseDossierSourceRequest,readDossierSources } from "@/lib/editorialDossierSources";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(req:Request){
 const auth=await requireEditor(req);if(!auth.ok)return reply({error:auth.error},401);
 const q=new URL(req.url).searchParams,topic=q.get("topic_id");
 if(!topic||!/^[1-9][0-9]*$/.test(topic)||!Number.isSafeInteger(Number(topic))||[...q.keys()].some(k=>k!=="topic_id"))return reply({error:"invalid-topic"},400);
 try{return reply(await readDossierSources(Number(topic)));}catch{return reply({error:"dossier-sources-unavailable"},503);}
}
export async function POST(req:Request){
 const auth=await requireEditor(req);if(!auth.ok)return reply({error:auth.error},401);
 const origin=req.headers.get("origin");if(origin&&origin!==new URL(req.url).origin)return reply({error:"invalid-origin"},403);
 if(Number(req.headers.get("content-length"))>8192)return reply({error:"request-too-large"},413);
 const raw=await req.text();if(Buffer.byteLength(raw)>8192)return reply({error:"request-too-large"},413);
 let body:unknown;try{body=JSON.parse(raw);}catch{return reply({error:"invalid-json"},400);}
 const input=parseDossierSourceRequest(body);if(!input)return reply({error:"invalid-dossier-source"},400);
 try{return reply({receipt:await attachDossierSource(input)});}catch{return reply({error:"The source could not be attached. Verify its complete MCP source receipt, current governance, dossier and request identity.",code:"dossier-source-conflict"},409);}
}
