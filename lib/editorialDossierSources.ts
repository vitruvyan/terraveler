import { dataApi, dataRpc } from "@/lib/deskAuth";
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type DossierSourceRequest={topic_id:number;consultation_id:string;title:string;request_id:string};
/** Labels are editor metadata. The server derives URL/text/rights from the MCP
 * receipt and current governance; these cannot be supplied by the caller. */
export function parseDossierSourceRequest(value:unknown):DossierSourceRequest|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!["topic_id","consultation_id","title","request_id"].includes(k))||
  !positive(v.topic_id)||typeof v.consultation_id!=="string"||!uuid.test(v.consultation_id)||
  typeof v.title!=="string"||!v.title.trim()||v.title.length>500||
  typeof v.request_id!=="string"||!/^[A-Za-z0-9_-]{16,100}$/.test(v.request_id))return null;
 return v as DossierSourceRequest;
}
export async function attachDossierSource(v:DossierSourceRequest,rpc=dataRpc){
 return rpc("editorial_attach_source",{p_topic_id:v.topic_id,p_consultation_id:v.consultation_id,p_title:v.title,p_request_id:v.request_id});
}
export async function readDossierSources(topicId:number,read=dataApi){
 if(!positive(topicId))throw Error("invalid-topic");
 const rows=await read("GET",`editorial_topic_sources?topic_id=eq.${topicId}&select=id,topic_id,consultation_id,title,created_at&order=id.desc&limit=40`);
 if(!Array.isArray(rows))throw Error("sources-unavailable");
 return {sources:rows,note:"Associations are immutable history. Current source policy is rechecked at corpus read and downstream use."};
}
