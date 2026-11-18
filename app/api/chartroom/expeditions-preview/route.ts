import {NextResponse} from "next/server";
import {newsroomPreviewEnabled} from "@/lib/newsroomPreview";
import {readPublicExpeditions} from "@/lib/chartroomPreview";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(){
 if(!newsroomPreviewEnabled())return reply({error:"not-found"},404);
 try{return reply(await readPublicExpeditions());}
 catch{return reply({error:"public-expeditions-unavailable"},503);}
}
