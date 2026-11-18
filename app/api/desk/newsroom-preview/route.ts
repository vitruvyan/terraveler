import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/deskAuth";
import { newsroomPreviewEnabled, readNewsroomPreview } from "@/lib/newsroomPreview";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(req:Request){
  if(!newsroomPreviewEnabled())return reply({error:"not-found"},404);
  try{
    const auth=await requireEditor(req);
    if(!auth.ok)return reply({error:"editor-required"},401);
    return reply(await readNewsroomPreview());
  }catch{return reply({error:"newsroom-unavailable"},503);}
}
