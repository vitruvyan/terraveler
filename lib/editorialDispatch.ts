import { dataApi, dataRpc } from "@/lib/deskAuth";
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
export type DispatchRequest={topic_id:number;plan_id:number;request_id:string};
export function parseDispatchRequest(value:unknown):DispatchRequest|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!["topic_id","plan_id","request_id"].includes(k))||!positive(v.topic_id)||!positive(v.plan_id)||typeof v.request_id!=="string"||!(/^[A-Za-z0-9_-]{16,100}$/).test(v.request_id))return null;
 return {topic_id:v.topic_id,plan_id:v.plan_id,request_id:v.request_id};
}
export async function dispatchPlan(v:DispatchRequest,rpc=dataRpc){
 return rpc("editorial_dispatch_plan",{p_topic_id:v.topic_id,p_plan_id:v.plan_id,p_request_id:v.request_id});
}
export async function readGraphStatus(topicId:number,read=dataApi){
 if(!positive(topicId))throw Error("invalid topic");
 const rows=await read("GET",`editorial_graph_status?topic_id=eq.${topicId}&order=id.desc&limit=20`);
 if(!Array.isArray(rows))throw Error("invalid graph response");
 return rows;
}
