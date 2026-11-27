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
export type RetryTaskRequest={task_id:number;expected_attempt:number;request_id:string;reason:string};
export function parseRetryTaskRequest(value:unknown):RetryTaskRequest|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!["task_id","expected_attempt","request_id","reason"].includes(k))||!positive(v.task_id)||!positive(v.expected_attempt)
  ||typeof v.request_id!=="string"||!(/^[A-Za-z0-9_-]{16,100}$/).test(v.request_id)
  ||typeof v.reason!=="string"||!/^\S(?:[\s\S]{0,498}\S)?$/.test(v.reason)||/[\x00-\x1f\x7f]/.test(v.reason))return null;
 return {task_id:v.task_id,expected_attempt:v.expected_attempt,request_id:v.request_id,reason:v.reason};
}
export async function retryEditorialTask(v:RetryTaskRequest,rpc=dataRpc){
 return rpc("desk_retry_editorial_task",{p_task_id:v.task_id,p_expected_attempt:v.expected_attempt,p_request_id:v.request_id,p_reason:v.reason});
}
export async function readGraphStatus(topicId:number,read=dataApi){
 if(!positive(topicId))throw Error("invalid topic");
 const rows=await read("GET",`editorial_graph_status?topic_id=eq.${topicId}&order=id.desc&limit=20`);
 if(!Array.isArray(rows))throw Error("invalid graph response");
 return rows;
}
