import {dataApi} from "@/lib/deskAuth";
import {getPublicProject,type PublicProject} from "@/lib/editorialProjectBridge";
type Read=(method:string,path:string)=>Promise<any>;
export type PublicExpedition={gap_id:number;title:string;description:string|null;kind:string;status:"open"|"claimed"|"done";claimed_by:string|null;claimed_at:string|null};
export type ExpeditionWindow={projects:PublicExpedition[];incomplete:boolean;checked_at:string;limit:number};
const LIMIT=12;
const id=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
/** Explicit linked work only, with the same live approval/membership checks as
 * GET /api/projects/[id]. No private dossier, task or plan fields are read.
 * The bounded window is not a total count or a claim of complete coverage. */
export async function readLinkedPublicProjects(read:Read=dataApi):Promise<{projects:PublicProject[];incomplete:boolean}>{
 const links=await read("GET","editorial_project_bridges?select=gap_id&order=gap_id.desc&limit="+LIMIT);
 if(!Array.isArray(links)||links.some(l=>!id(l?.gap_id)))throw Error("Invalid bridge window");
 const ids=[...new Set<number>(links.map(l=>l.gap_id))].slice(0,LIMIT);
 const projects:PublicProject[]=[];
 let incomplete=false;
 // Bound concurrent canonical lookups. Failure of one item never turns it
 // into a public project or an invented empty result.
 for(let i=0;i<ids.length;i+=4){
  const batch=await Promise.allSettled(ids.slice(i,i+4).map(gap=>getPublicProject(gap,read)));
  for(const result of batch){
   if(result.status==="rejected"){incomplete=true;continue;}
   const p=result.value;if(!p)continue;
   projects.push(p);
  }
 }
 return {projects,incomplete};
}

export async function readPublicExpeditions(read:Read=dataApi):Promise<ExpeditionWindow>{
 const {projects,incomplete}=await readLinkedPublicProjects(read);
 return {projects:projects.map(p=>({gap_id:p.gap_id,title:p.title,description:p.description,kind:p.kind,status:p.status,claimed_by:p.claimed_by,claimed_at:p.claimed_at})),incomplete,checked_at:new Date().toISOString(),limit:LIMIT};
}
