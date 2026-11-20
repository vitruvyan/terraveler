"use client";
import {useEffect,useState} from "react";
import Icon from "@/components/Icon";
import WallArtwork from "@/components/desk/WallArtwork";
import CrewPortrait from "@/components/desk/CrewPortrait";
import type {PublicCrewSnapshot,PublicCrewProfile,PublicCrewEvent} from "@/lib/publicCrewPreview";
import {formatDate,Unavailable} from "../shared";
const storageKey="terraveler:preview:followed-editorial-personas";
export function eventText(e:PublicCrewEvent){return e.kind==="assignment-started"?"An editorial assignment began.":"A candidate result was recorded; editorial approval is separate.";}
export function CrewJournal({events,profiles}:{events:PublicCrewEvent[]|null;profiles:PublicCrewProfile[]}){
 return events===null?<Unavailable/>:events.length?<div className="cr-feed cr-journal">{events.map(e=><article key={e.id}><span className="cr-feed-icon"><Icon name={e.kind==="candidate-recorded"?"check":"quill"}/></span><div><span className="ln-meta">{formatDate(e.at)}</span><h3>{profiles.find(p=>p.key===e.agent)?.name??"Editorial crew"}</h3><p>{eventText(e)}</p><p className="ln-meta">{e.expedition.title}</p></div></article>)}</div>:<p>No public assignment events in the inspected window.</p>;
}
export default function EditorialCrew({snapshot,busy,error,compact=false,onExplore}:{snapshot:PublicCrewSnapshot|null;busy:boolean;error:string;compact?:boolean;onExplore:()=>void}){
 const [followed,setFollowed]=useState<string[]>([]),[onlyFollowed,setOnlyFollowed]=useState(false),[ready,setReady]=useState(false),[storageError,setStorageError]=useState(false);
 useEffect(()=>{try{const value=JSON.parse(localStorage.getItem(storageKey)??"[]");if(Array.isArray(value))setFollowed(value.filter((v:unknown)=>typeof v==="string"));}catch{}setReady(true);},[]);
 function follow(key:string){const next=followed.includes(key)?followed.filter(v=>v!==key):[...followed,key];setFollowed(next);try{localStorage.setItem(storageKey,JSON.stringify(next));setStorageError(false);}catch{setStorageError(true);}}
 if(!snapshot)return <>{error&&<p className="ln-error" role="alert">{error}</p>}{busy?<p role="status">Reading editorial crew records…</p>:<Unavailable/>}</>;
 const profiles=snapshot.profiles??[];
 const visible=profiles.filter(p=>!onlyFollowed||followed.includes(p.key));
 return <div className="cr-editorial-crew">
 {snapshot.incomplete&&<p className="ln-meta" role="status">The public record window is incomplete. No unverified activity is inferred.</p>}
 {!compact&&<div className="cr-follow-tools"><button type="button" aria-pressed={!onlyFollowed} onClick={()=>setOnlyFollowed(false)}>All specialists</button><button type="button" aria-pressed={onlyFollowed} onClick={()=>setOnlyFollowed(true)}>Following · {profiles.filter(p=>followed.includes(p.key)).length}</button><span className="ln-meta">{storageError?"Browser storage unavailable; selections last for this visit.":"Follows are saved in this browser only."}</span></div>}
 {visible.length?<div className="cr-editorial-grid">{visible.slice(0,compact?4:100).map(p=><article className="cr-agent" key={p.key}><header><div className="cr-agent-emblem" data-persona={p.key}><CrewPortrait personaKey={p.key} icon={p.icon}/></div><div><span className="ln-kicker">Internal crew</span><h3>{p.name}</h3><p>{p.title}</p></div></header><p className="cr-agent-bio">{p.bio}</p><p className="cr-agent-status" data-status={p.status}><span aria-hidden="true"/>{p.status==="assignment-recorded"?"Public assignment in progress":p.status==="unavailable"?"Public activity incomplete":"No current public assignment observed"}</p>
 {p.current.length>0&&<section className="cr-agent-current"><span className="ln-kicker">Current expedition</span><WallArtwork title={p.current[0].title}/>{p.current.map(x=><p key={x.id}>{x.title}</p>)}<button onClick={onExplore}>Explore expeditions →</button></section>}
 <details><summary>Research journal · {p.journal.length} recent records</summary><CrewJournal events={snapshot.activity===null?null:p.journal} profiles={profiles}/><p className="ln-meta">Recorded task milestones only. Evidence-linked research summaries and individual discoveries require public editorial clearance.</p></details>
 <button type="button" className="cr-follow" disabled={!ready} aria-pressed={followed.includes(p.key)} onClick={()=>follow(p.key)}><Icon name={followed.includes(p.key)?"check":"pin"}/>{followed.includes(p.key)?"Following":"Follow specialist"}</button></article>)}</div>:<p>{onlyFollowed?"No followed specialists in this register.":"No registered public editorial persona is available."}</p>}
 <p className="ln-meta">Named editorial personas · public assignment records, not model identity or system health.</p></div>;
}
