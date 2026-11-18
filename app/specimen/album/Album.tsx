"use client";
import {useRef,useState} from "react";
import type {AlbumEntry,AlbumKind} from "@/lib/visualAlbum";
import Icon from "@/components/Icon";
const categories:{id:"all"|AlbumKind;label:string}[]=[{id:"all",label:"All images"},{id:"artwork",label:"Original artwork"},{id:"cartography",label:"Historical maps"},{id:"photography",label:"Photography"}];
const states={available:"In library",pending:"Awaiting asset", "reference-only":"Rights not verified"};
export default function Album({entries}:{entries:readonly AlbumEntry[]}){
 const [kind,setKind]=useState<"all"|AlbumKind>("all"),[query,setQuery]=useState(""),[selected,setSelected]=useState<AlbumEntry|null>(null);
 const dialog=useRef<HTMLDialogElement>(null), opener=useRef<HTMLButtonElement|null>(null);
 const q=query.trim().toLowerCase();
 const visible=entries.filter(e=>(kind==="all"||kind===e.kind)&&[e.title,e.collection,e.credit,e.date,e.alt,e.use].join(" ").toLowerCase().includes(q));
 function open(e:AlbumEntry,button:HTMLButtonElement){opener.current=button;setSelected(e);dialog.current?.showModal();}
 function close(){dialog.current?.close();}
 return <>
 <div className="va-toolbar"><div className="va-filters" aria-label="Image collections">{categories.map(c=><button type="button" key={c.id} aria-pressed={kind===c.id} onClick={()=>setKind(c.id)}>{c.label} <span>{entries.filter(e=>c.id==="all"||e.kind===c.id).length}</span></button>)}</div><label className="va-search"><Icon name="lens"/><span className="va-sr">Search album</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a subject, artist or collection…"/></label></div>
 <p className="va-meta" role="status">{visible.length} records · {visible.filter(e=>e.state==="available").length} in library · {visible.filter(e=>e.state==="pending").length} awaiting assets · {visible.filter(e=>e.state==="reference-only").length} reference only</p>
 {visible.length?<div className="va-grid">{visible.map(e=><article className="va-card" key={e.id}><button type="button" className="va-image" onClick={ev=>open(e,ev.currentTarget)} aria-label={"Inspect "+e.title}>{e.src?<img src={e.src} alt={e.alt} loading="lazy" decoding="async"/>:<span className="va-placeholder"><Icon name="plates"/><span>Artwork awaiting asset</span></span>}<span className="va-inspect"><Icon name="lens"/> Inspect</span></button><div className="va-copy"><p className="va-meta">{e.collection}</p><h2>{e.title}</h2><p className="va-meta">{e.credit} · {e.date}</p><p>{e.use}</p><span className="va-state" data-state={e.state}>{states[e.state]}</span></div></article>)}</div>:<p>No visual references match this search.</p>}
 <dialog ref={dialog} className="va-dialog" aria-labelledby="va-dialog-title" onClose={()=>{opener.current?.focus();setSelected(null);}} onClick={e=>{if(e.target===e.currentTarget)close();}}>{selected&&<div className="va-detail"><header><div><span className="va-meta">{selected.collection}</span><h2 id="va-dialog-title">{selected.title}</h2></div><button type="button" onClick={close} autoFocus aria-label="Close image"><Icon name="close"/> Close</button></header>{selected.src?<img className="va-full" src={selected.src} alt={selected.alt}/>:<p>Original image has not yet been committed to the asset library.</p>}<dl><div><dt>Asset ID</dt><dd>{selected.id}</dd></div><div><dt>Credit</dt><dd>{selected.credit}</dd></div><div><dt>Image date</dt><dd>{selected.date}</dd></div><div><dt>Rights</dt><dd>{selected.license}</dd></div><div><dt>Editorial use</dt><dd>{selected.use}</dd></div><div><dt>Editorial limit</dt><dd>{selected.caution}</dd></div>{selected.source&&<div><dt>Source</dt><dd><a href={selected.source} target="_blank" rel="noreferrer">Open source record ↗</a></dd></div>}</dl>{selected.src&&selected.state==="available"&&<a href={selected.src} target="_blank" rel="noreferrer">Open original asset ↗</a>}</div>}</dialog>
 </>;
}
