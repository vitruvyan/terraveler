"use client";
import { useCallback,useEffect,useRef,useState, type ReactNode } from "react";
import Icon,{type IconName} from "@/components/Icon";
export function useSnapshot<T>(url:string, editor=false){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true),[denied,setDenied]=useState(false);
 const gate=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
   if(gate.current)return;
   const ctl=new AbortController();gate.current=ctl;setBusy(true);
   const timer=window.setTimeout(()=>ctl.abort(),30000);
   try{
     if(editor){
       const me=await fetch("/api/desk/me",{cache:"no-store",signal:ctl.signal});
       if(!me.ok)throw Error("The editor session could not be checked.");
       const identity=await me.json();
       if(!identity.signed_in||!identity.is_editor){setData(null);setDenied(true);setError("");return;}
     }
     const response=await fetch(url,{cache:"no-store",signal:ctl.signal});
     if(response.status===401||response.status===403){setData(null);setDenied(true);setError("");return;}
     if(!response.ok)throw Error("The latest records could not be read.");
     const result=await response.json();
     if(!ctl.signal.aborted){setData(result);setError("");setDenied(false);}
   }catch{if(gate.current===ctl){setData(null);setError("The latest records could not be read. Refresh to try again.");}}
   finally{window.clearTimeout(timer);if(gate.current===ctl){gate.current=null;setBusy(false);}}
 },[url,editor]);
 useEffect(()=>{
   void refresh();
   const visible=()=>{if(document.visibilityState==="visible")void refresh();};
   const timer=window.setInterval(visible,45000);
   document.addEventListener("visibilitychange",visible);
   return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);const prior=gate.current;gate.current=null;prior?.abort();};
 },[refresh]);
 return {data,error,busy,denied,refresh};
}
export function Mast({title,eyebrow,description,children}:{title:string;eyebrow:string;description:string;children?:ReactNode}){
 return <header className="ln-mast"><div><span className="ln-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children}</header>;
}
export function PreviewBanner({editor=false}:{editor?:boolean}){
 return <div className="ln-banner"><span><Icon name="compass"/> Living Newsroom · Connected preview</span><span>{editor?"Editor-only · Read-only newsroom":"Public records · No private data requested"}</span><a href="/living-newsroom">Design laboratory</a></div>;
}
export function Panel({title,kicker,children,action}:{title:string;kicker?:string;children:ReactNode;action?:ReactNode}){
 return <section className="ln-panel"><div className="ln-heading"><div>{kicker&&<span className="ln-kicker">{kicker}</span>}<h2>{title}</h2></div>{action}</div>{children}</section>;
}
export function Metric({value,label,onClick}:{value:number|null;label:string;onClick:()=>void}){
 return <button onClick={onClick}><strong>{value===null?"—":value}</strong><span>{label}{value===null?" · unavailable":""} →</span></button>;
}
export function PersonCard({name,role,icon,status,children,details,avatar}:{name:string;role:string;icon:IconName;status:string;children?:ReactNode;details:ReactNode;avatar?:ReactNode}){
 return <article className="ln-person ln-connected-person"><details><summary><span className="ln-avatar">{avatar??<Icon name={icon}/>}</span><span><strong>{name}</strong><span className="ln-meta">{role}</span></span></summary><div className="ln-person-detail">{details}</div></details><span className="ln-meta ln-observed-state">{status}</span>{children}</article>;
}
export function Unavailable(){return <p className="ln-meta">Records unavailable. This is not an empty queue.</p>;}
export function formatDate(value:string){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString("en-GB",{dateStyle:"short",timeStyle:"medium",timeZone:"UTC"})+" UTC":"Date unavailable";}
