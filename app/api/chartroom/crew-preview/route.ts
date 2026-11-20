import {NextResponse} from "next/server";
import {newsroomReadEnabled} from "@/lib/newsroomRelease";
import {readPublicCrewPreview} from "@/lib/publicCrewPreview";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(){
 if(!newsroomReadEnabled("chartroom"))return reply({error:"not-found"},404);
 try{return reply(await readPublicCrewPreview());}
 catch{return reply({error:"public-crew-unavailable"},503);}
}
