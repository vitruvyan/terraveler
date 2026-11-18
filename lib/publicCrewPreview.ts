import {dataApi} from "@/lib/deskAuth";
import {readLinkedPublicProjects} from "@/lib/chartroomPreview";
import type {PublicProject} from "@/lib/editorialProjectBridge";
import {EDITORIAL_PERSONAS,editorialPersona,type EditorialPersona} from "@/lib/editorialPersonas";
type Read=(method:string,path:string)=>Promise<any>;
export type PublicCrewEvent={id:string;at:string;kind:"assignment-started"|"candidate-recorded";agent:string;expedition:{id:number;title:string}};
export type PublicCrewProfile={key:string;name:string;title:string;icon:EditorialPersona["icon"];bio:string;current:{id:number;title:string}[];journal:PublicCrewEvent[];status:"assignment-recorded"|"no-current-public-assignment"|"unavailable"};
export type PublicCrewSnapshot={version:1;checked_at:string;profiles:PublicCrewProfile[]|null;activity:PublicCrewEvent[]|null;incomplete:boolean};
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const timestamp=(v:unknown)=>typeof v==="string"?Date.parse(v):NaN;
const one=(v:any)=>Array.isArray(v)?v[0]:v;
async function rows(read:Read,path:string):Promise<any[]>{const r=await read("GET",path);if(!Array.isArray(r))throw Error("Unavailable");return r;}
type BoundTask={id:number;project:{id:number;title:string};agent:string;boundAt:number;running:boolean};
export function projectPublicCrewEvents(records:any[],tasks:BoundTask[]):PublicCrewEvent[]{
 const map=new Map(tasks.map(t=>[t.id,t]));
 return records.flatMap(e=>{
  const task=map.get(e?.task_id),at=timestamp(e?.created_at);
  if(!task||!positive(e?.id)||!Number.isFinite(at)||at<task.boundAt||!["claimed","completed"].includes(e.event))return [];
  return [{id:"editorial-task:"+e.id,at:e.created_at,kind:e.event==="claimed"?"assignment-started":"candidate-recorded",agent:task.agent,expedition:task.project} as PublicCrewEvent];
 }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Number(b.id.split(":")[1])-Number(a.id.split(":")[1]));
}
/** Preview only: static approved public persona definitions, canonical public
 * bridges, immutable task binding and two safe event categories. Never read
 * raw task payloads, detail, candidate result, trace, model or instructions.
 * The existence of a public bridge is required even for an assignment event.
 * Task completion means a candidate was recorded, never publication. */
export async function readPublicCrewPreview(read:Read=dataApi,linked:()=>Promise<{projects:PublicProject[];incomplete:boolean}>=()=>readLinkedPublicProjects(read),now=Date.now()):Promise<PublicCrewSnapshot>{
 const checked_at=new Date(now).toISOString();
 const registry=await rows(read,"editorial_specialist_agents_current?select=agent_key,role,specialty&agent_key=in.("+EDITORIAL_PERSONAS.map(p=>p.key).join(",")+")&limit=20");
 const active=[...new Map(registry.flatMap(row=>{const p=editorialPersona(row.agent_key,row.role,row.specialty);return p?[[p.key,p] as const]:[];})).values()];
 const result=(tasks:BoundTask[],events:PublicCrewEvent[]|null,incomplete:boolean):PublicCrewSnapshot=>({
  version:1,checked_at,incomplete,activity:events,profiles:active.map(p=>{
   const current=[...new Map(tasks.filter(t=>t.agent===p.key&&t.running).map(t=>[t.project.id,t.project])).values()];
   return {key:p.key,name:p.name,title:p.title,icon:p.icon,bio:p.bio,current,journal:events?.filter(e=>e.agent===p.key).slice(0,8)??[],status:current.length?"assignment-recorded":events===null||incomplete?"unavailable":"no-current-public-assignment"};
  })
 });
 if(!active.length)return result([],[],false);
 try{
  const window=await linked();
  const projects=new Map(window.projects.map(p=>[p.topic_id,{id:p.gap_id,title:p.title}]));
  if(!projects.size)return result([],window.incomplete?null:[],window.incomplete);
  const taskRows=await rows(read,"editorial_tasks?topic_id=in.("+[...projects.keys()].join(",")+")&select=id,topic_id,role,state,lease_expires_at,editorial_task_agents(created_at,editorial_agent_versions(agent_key,role))&order=id.desc&limit=100");
  const keys=new Map(active.map(p=>[p.key,p]));
  const tasks:BoundTask[]=taskRows.flatMap(t=>{
   const project=projects.get(t.topic_id),binding=one(t.editorial_task_agents),agent=one(binding?.editorial_agent_versions);
   const persona=keys.get(agent?.agent_key),boundAt=timestamp(binding?.created_at);
   if(!project||!positive(t.id)||!persona||persona.role!==t.role||agent.role!==t.role||!Number.isFinite(boundAt))return [];
   return [{id:t.id,project,agent:persona.key,boundAt,running:t.state==="running"&&timestamp(t.lease_expires_at)>now}];
  });
  if(!tasks.length)return result([],window.incomplete?null:[],window.incomplete||taskRows.length===100);
  const eventRows=await rows(read,"editorial_task_events?task_id=in.("+tasks.map(t=>t.id).join(",")+")&event=in.(claimed,completed)&select=id,task_id,event,created_at&order=id.desc&limit=80");
  return result(tasks,projectPublicCrewEvents(eventRows,tasks),window.incomplete||taskRows.length===100||eventRows.length===80);
 }catch{return result([],null,true);}
}
