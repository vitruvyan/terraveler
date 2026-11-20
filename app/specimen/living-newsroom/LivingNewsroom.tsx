"use client";

import { useEffect, useState, type FormEvent } from "react";
import Icon, { type IconName } from "@/components/Icon";
import WallArtwork from "@/components/desk/WallArtwork";

type Screen = "desk" | "wall" | "projects" | "crew" | "inbox" | "reader";
type Idea = { id: number; title: string; author: string; text: string; state: "new" | "saved" | "accepted" | "dismissed"; comments: string[] };
type Project = { id: number; title: string; stage: string; next: string; owner: string };
type DiaryEvent = { id:number; at:string; name:string; role:string; kind:string; title:string; detail:string; icon:IconName; public:boolean; project:string };
type Note = { id:number; quote:string; body:string; state:"open"|"resolved" };
const initialIdeas: Idea[] = [
  {id:1,title:"The seven voyages of Zheng He",author:"Mercator · Cartographer",text:"Trace the Ming expeditions through the Indian Ocean, with particular attention to the ports and local accounts.",state:"new",comments:[]},
  {id:2,title:"The lost kingdom of Aksum",author:"Herodotus · Historian",text:"Reconstruct the routes and exchanges of a kingdom at the crossroads of Africa and Arabia.",state:"new",comments:[]},
  {id:3,title:"Reading the maps of Piri Reis",author:"Mnemosyne · Archivist",text:"Explore the surviving cartographic record and the history of its interpretation.",state:"new",comments:[]},
  {id:4,title:"In the footsteps of Ibn Battuta",author:"Herodotus · Historian",text:"Follow the Moroccan traveler across the medieval Islamic world through the geography of his Rihla.",state:"new",comments:[]},
  {id:5,title:"The lost library of Alexandria",author:"Editor",text:"Explore the geography of ancient scholarship and the histories of lost knowledge.",state:"saved",comments:[]},
];
const initialProjects: Project[] = [
  {id:10,title:"The Endurance expedition",stage:"Research",next:"Inspect the proposed photographic evidence.",owner:"Mnemosyne"},
  {id:11,title:"Cabeza de Vaca",stage:"Editorial review",next:"Read the revised manuscript.",owner:"Calliope"},
  {id:12,title:"The Silk Road",stage:"Source verification",next:"Compare the two historical accounts.",owner:"Herodotus"},
];
const people: {name:string; role:string; origin:string; task:string; project:string; status:string; icon:IconName; distinction:string; approved:number}[] = [
  {name:"Herodotus",role:"Historian",origin:"Terraveler",task:"Comparing historical accounts",project:"The Silk Road",status:"Researching",icon:"antiquity",distinction:"Trusted scholar",approved:24},
  {name:"Mnemosyne",role:"Archivist",origin:"Terraveler",task:"Checking archival provenance",project:"The Endurance expedition",status:"Researching",icon:"plates",distinction:"Source hunter",approved:18},
  {name:"Mercator",role:"Cartographer",origin:"Terraveler",task:"Tracing expedition waypoints",project:"The Endurance expedition",status:"Mapping",icon:"map",distinction:"Pathfinder",approved:12},
  {name:"Calliope",role:"Writer",origin:"Terraveler",task:"Revising a manuscript",project:"Cabeza de Vaca",status:"Writing",icon:"quill",distinction:"First chart",approved:7},
  {name:"Scribe 07",role:"Contributor",origin:"External",task:"Source proposal received",project:"The Silk Road",status:"Observed contribution",icon:"scroll",distinction:"Peer eye",approved:6},
];
const timeline: DiaryEvent[] = [
  {id:1,at:"12:42:36",name:"Scribe 07",role:"External contributor",kind:"Contribution",title:"Submitted a historical reference",detail:"A reference was proposed through the contribution surface. Awaiting editorial verification.",icon:"scroll",public:true,project:"The Silk Road"},
  {id:2,at:"12:44:09",name:"Mnemosyne",role:"Archivist",kind:"Discovery",title:"Found a candidate expedition photograph",detail:"Archive discovery recorded. Provenance and reproduction rights are not yet verified.",icon:"plates",public:true,project:"The Endurance expedition"},
  {id:3,at:"12:45:51",name:"Mercator",role:"Cartographer",kind:"Mapping",title:"Compared the landing coordinates",detail:"Candidate waypoint updated; historical evidence still under review.",icon:"map",public:true,project:"The Endurance expedition"},
  {id:4,at:"12:46:18",name:"Calliope",role:"Writer",kind:"Writing",title:"Saved a manuscript revision",detail:"A private draft version is ready for the editor to inspect.",icon:"quill",public:false,project:"Cabeza de Vaca"},
  {id:5,at:"12:46:32",name:"Herodotus",role:"Historian",kind:"Verification",title:"Identified conflicting historical accounts",detail:"Two candidate accounts disagree. A decision requires further evidence.",icon:"lens",public:true,project:"The Silk Road"},
  {id:6,at:"12:48:02",name:"Mnemosyne",role:"Archivist",kind:"Discovery",title:"Recorded an archive consultation",detail:"Example consultation complete; image rights still pending. No image publication is authorized.",icon:"plates",public:true,project:"The Endurance expedition"},
  {id:7,at:"12:49:05",name:"Mercator",role:"Cartographer",kind:"Mapping",title:"Proposed a waypoint for review",detail:"A geographic candidate was sent to the editorial desk.",icon:"pin",public:true,project:"The Endurance expedition"},
  {id:8,at:"12:50:30",name:"Calliope",role:"Writer",kind:"Writing",title:"Prepared a new chapter draft",detail:"The editor must approve the precise manuscript version before publication.",icon:"quill",public:false,project:"Cabeza de Vaca"},
];
const passages = [
  "The expedition left Britain in 1914, bound for the Antarctic. Its ambition was to cross the continent, but the ice gave the voyage a different course.",
  "The Endurance became trapped in the Weddell Sea. The crew waited as the drifting pack carried their ship across the frozen waters.",
  "After abandoning the ship, the men eventually reached Elephant Island. A small party then set out in the James Caird to seek help.",
];
const nav: {id:Screen; label:string; icon:IconName}[] = [
  {id:"desk",label:"Editorial desk",icon:"compass"},{id:"wall",label:"Editorial wall",icon:"pin"},
  {id:"projects",label:"Projects",icon:"map"},{id:"crew",label:"The living crew",icon:"mariner"},
  {id:"inbox",label:"Editorial inbox",icon:"record"},{id:"reader",label:"Article & marginal notes",icon:"quill"},
];

export default function LivingNewsroom() {
  const [screen,setScreen] = useState<Screen>("desk");
  const [ideas,setIdeas] = useState(initialIdeas);
  const [projects,setProjects] = useState(initialProjects);
  const [notes,setNotes] = useState<Note[]>([{id:1,quote:passages[1],body:"Could we add a reference to the original expedition diary here?",state:"open"}]);
  const [composerOpen,setComposerOpen] = useState(false);
  const [title,setTitle] = useState("");
  const [description,setDescription] = useState("");
  const [ideaFilter,setIdeaFilter] = useState<Idea["state"]>("new");
  const [discussion,setDiscussion] = useState<number|null>(null);
  const [comment,setComment] = useState("");
  const [cursor,setCursor] = useState(5);
  const [playing,setPlaying] = useState(false);
  const [audience,setAudience] = useState<"editor"|"public">("editor");
  const [origin,setOrigin] = useState("all");
  const [kind,setKind] = useState("all");
  const [selectedPerson,setSelectedPerson] = useState<string|null>(null);
  const [activePassage,setActivePassage] = useState<number|null>(null);
  const [noteBody,setNoteBody] = useState("");
  const [notice,setNotice] = useState("");
  const [projectId,setProjectId] = useState<number|null>(null);

  useEffect(()=>{
    if (!playing) return;
    if (cursor >= timeline.length) { setPlaying(false); return; }
    const timer = window.setTimeout(()=>setCursor(n=>Math.min(n+1,timeline.length)),2200);
    return ()=>window.clearTimeout(timer);
  },[playing,cursor]);

  function go(s: Screen) {setScreen(s);setNotice("");setProjectId(null);}
  function addIdea(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!title.trim() || !description.trim()) return;
    setIdeas(old=>[{id:Date.now(),title:title.trim(),text:description.trim(),author:"You · Editor",state:"new",comments:[]},...old]);
    setTitle("");setDescription("");setComposerOpen(false);setIdeaFilter("new");go("wall");setNotice("Idea pinned to the wall (sandbox only).");
  }
  function decide(idea:Idea,state:Idea["state"]) {
    setIdeas(old=>old.map(x=>x.id===idea.id?{...x,state}:x));
    if(state==="accepted") setProjects(old=>old.some(p=>p.id===idea.id)?old:[...old,{id:idea.id,title:idea.title,stage:"Orientation",owner:"Managing editor",next:"Prepare a Wikipedia outline and proposed editorial plan."}]);
    setNotice(state==="accepted"?"Project created in this sandbox. No agent was started.":"Idea moved to "+state+".");
  }
  function submitNote(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(activePassage===null||!noteBody.trim())return;
    setNotes(old=>[{id:Date.now(),quote:passages[activePassage],body:noteBody.trim(),state:"open"},...old]);
    setNoteBody("");setActivePassage(null);setNotice("Note delivered to the sandbox inbox.");
  }
  const pending=ideas.filter(x=>x.state==="new");
  const openNotes=notes.filter(x=>x.state==="open");
  const events=timeline.slice(0,cursor).filter(x=>(audience==="editor"||x.public)&&(kind==="all"||x.kind===kind)).reverse();
  const stats=[{value:pending.length,label:"Ideas to consider",to:"wall" as const},{value:projects.length,label:"Expeditions in progress",to:"projects" as const},{value:openNotes.length,label:"Reader notes",to:"inbox" as const}];
  const sectionTitle=nav.find(n=>n.id===screen)?.label;

  function feed(compact=false) {
    return <section className="ln-panel ln-feed" aria-label="Editorial activity">
      <div className="ln-heading"><div><span className="ln-kicker">The newsroom pulse</span><h2>Knowledge in the making</h2></div><span className="ln-replay"><i/> Fixture replay</span></div>
      {!compact&&<div className="ln-actions"><button onClick={()=>{setCursor(0);setPlaying(true);}}>Replay events</button><button onClick={()=>setPlaying(x=>!x)} disabled={cursor>=timeline.length}>{playing?"Pause":"Resume"}</button><label>Event type <select value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All</option>{Array.from(new Set(timeline.map(x=>x.kind))).map(k=><option key={k}>{k}</option>)}</select></label></div>}
      <div className="ln-feed-list" aria-live="polite">{(compact?events.slice(0,3):events).map(e=><article key={e.id} className="ln-event">
        <span className="ln-event-icon"><Icon name={e.icon}/></span><div><div className="ln-event-meta"><time>{e.at}</time> · {e.name} · {e.kind}{!e.public&&<span> · Private</span>}</div><h3>{e.title}</h3><p>{e.detail}</p><span className="ln-meta">{e.project}</span></div>
      </article>)}{!events.length&&<p>No matching events in this replay frame.</p>}</div>
      {compact&&<button onClick={()=>go("crew")}>Open the living crew →</button>}
    </section>;
  }

  return <div className="ln-lab">
    <div className="ln-banner"><span><Icon name="compass"/> Living Newsroom · Preview laboratory</span><span>Simulated records · No backend writes · Not live</span><a href="/living-newsroom/live">Connected editorial desk</a><a href="/living-newsroom/chartroom">Connected public Chartroom</a><a href="/specimen/album">Visual album</a><a href="/specimen/newsroom">Back to specimen</a></div>
    <div className="ln-shell">
      <nav className="ln-nav" aria-label="Preview navigation">
        <div className="ln-nav-brand"><img src="/brand/terraveler-favicon.svg" alt="" width="48" height="48"/><div><strong>Terraveler</strong><span>Editorial studio</span></div></div>
        <span className="ln-kicker">Newsroom</span>
        {nav.map(n=><button key={n.id} aria-current={screen===n.id?"page":undefined} onClick={()=>go(n.id)}><Icon name={n.icon}/><span>{n.label}</span>{n.id==="wall"&&pending.length>0&&<b>{pending.length}</b>}{n.id==="inbox"&&openNotes.length>0&&<b>{openNotes.length}</b>}</button>)}
        <div className="ln-nav-footer"><span className="ln-kicker">Existing site</span><a href="/desk"><Icon name="compass"/> Current desk ↗</a><a href="/"><Icon name="globe"/> Atlas ↗</a></div>
      </nav>
      <main className="ln-main" id="ln-main">
        <header className="ln-mast"><div><span className="ln-kicker">Terraveler / {screen==="crew"?"The chartroom": "Editorial studio"}</span><h1>{screen==="desk"?"The editorial desk":sectionTitle}</h1><p>{screen==="desk"?"A world of stories waiting to be told.":screen==="wall"?"Every journey begins with an idea.":screen==="crew"?"A window into our collective exploration.":screen==="inbox"?"From the margins of the atlas to the editor’s table.":screen==="reader"?"A reading room with a conversation in its margins.":"Follow the voyage from idea to published knowledge."}</p></div>{screen!=="wall"&&<button className="ln-primary" onClick={()=>go("wall")}>+ Pin an idea</button>}</header>
        <p role="status" className="ln-notice">{notice}</p>
        {screen==="desk"&&<>
          <section className="ln-brief"><div><span className="ln-kicker">Morning briefing · demonstration</span><h2>Good morning, Editor.</h2><p>{projects.length} expeditions are on the editorial table. {pending.length} ideas await your decision, and {openNotes.length} reader notes need attention.</p></div><img src="/brand/terraveler-favicon.svg" width="90" height="90" alt=""/></section>
          <div className="ln-stats">{stats.map(s=><button key={s.to} onClick={()=>go(s.to)}><strong>{s.value}</strong><span>{s.label} →</span></button>)}</div>
          <div className="ln-desk-grid"><div className="ln-stack">
            <section className="ln-panel"><div className="ln-heading"><div><span className="ln-kicker">Your decisions</span><h2>On the editorial table</h2></div><button onClick={()=>go("projects")}>All projects →</button></div>{projects.map(p=><button className="ln-project-row" key={p.id} onClick={()=>{go("projects");setProjectId(p.id);}}><Icon name="scroll"/><div><h3>{p.title}</h3><p>{p.next}</p><span className="ln-meta">{p.stage} · {p.owner}</span></div><span aria-hidden="true">→</span></button>)}</section>
            <section className="ln-panel"><div className="ln-heading"><h2>From the wall</h2><button onClick={()=>go("wall")}>See ideas →</button></div>{pending.length?pending.map(i=><button className="ln-project-row" key={i.id} onClick={()=>go("wall")}><Icon name="pin"/><div><h3>{i.title}</h3><span className="ln-meta">{i.author}</span></div><span>→</span></button>):<p>All ideas reviewed.</p>}</section>
          </div>{feed(true)}</div>
        </>}
        {screen==="wall"&&<>
          <button type="button" className="ln-wall-compose" aria-expanded={composerOpen} onClick={()=>setComposerOpen(v=>!v)}><span aria-hidden="true">{composerOpen?"−":"+"}</span> {composerOpen?"Close idea composer":"Pin a new idea…"}</button>
          {composerOpen&&<form className="ln-panel ln-composer" onSubmit={addIdea}><h2>Pin a new idea</h2><label>Title<input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)} required placeholder="A journey, a discovery, a forgotten story…"/></label><label>Editorial suggestion<textarea value={description} maxLength={1200} onChange={e=>setDescription(e.target.value)} required placeholder="What should the crew explore, and why?"/></label><button className="ln-primary" type="submit" disabled={!title.trim()||!description.trim()}>Pin to the wall</button></form>}
          <div className="ln-actions ln-filter">{(["new","saved","accepted","dismissed"] as const).map(s=><button key={s} aria-pressed={ideaFilter===s} onClick={()=>{setIdeaFilter(s);setDiscussion(null);}}>{s==="new"?"New ideas":s[0].toUpperCase()+s.slice(1)} · {ideas.filter(i=>i.state===s).length}</button>)}</div>
          <div className="ln-wall">{ideas.filter(i=>i.state===ideaFilter).map(i=><article key={i.id} className="ln-idea ln-illustrated-idea"><WallArtwork title={i.title}/><div className="ln-idea-copy"><span className="ln-kicker">Proposed by {i.author}</span><h2>{i.title}</h2><p>{i.text}</p></div><div className="ln-actions ln-wall-actions">{i.state!=="accepted"&&<button className="ln-primary" onClick={()=>decide(i,"accepted")}><Icon name="check"/> Accept</button>}<button onClick={()=>{setDiscussion(discussion===i.id?null:i.id);setComment("");}}><Icon name="dialogue"/> Discuss</button>{i.state==="new"&&<button onClick={()=>decide(i,"saved")}><Icon name="record"/> Save</button>}{i.state==="new"||i.state==="saved"?<button onClick={()=>decide(i,"dismissed")}><Icon name="close"/> Dismiss</button>:i.state==="dismissed"?<button onClick={()=>decide(i,"new")}>Restore</button>:<button onClick={()=>{go("projects");setProjectId(i.id);}}>View project</button>}</div>
          {discussion===i.id&&<form className="ln-discussion" onSubmit={e=>{e.preventDefault();if(!comment.trim())return;setIdeas(old=>old.map(x=>x.id===i.id?{...x,comments:[...x.comments,comment.trim()]}:x));setComment("");}}><h3>Editorial discussion</h3>{i.comments.map((c,n)=><p key={n}><strong>Editor:</strong> {c}</p>)}<label>Your comment<textarea value={comment} onChange={e=>setComment(e.target.value)} required maxLength={1200}/></label><button type="submit" disabled={!comment.trim()}>Add comment</button><span className="ln-meta">Local comments only; no agent response is generated.</span></form>}
          </article>)}{!ideas.some(i=>i.state===ideaFilter)&&<p>Nothing pinned here yet.</p>}</div>
        </>}
        {screen==="projects"&&<section className="ln-panel"><div className="ln-heading"><h2>Expeditions</h2><span className="ln-meta">{projects.length} sandbox projects</span></div>{projects.map(p=><article key={p.id} className="ln-project"><button className="ln-project-row" aria-expanded={projectId===p.id} onClick={()=>setProjectId(projectId===p.id?null:p.id)}><Icon name="map"/><div><h3>{p.title}</h3><span className="ln-meta">{p.stage} · {p.owner}</span></div><span>{projectId===p.id?"−":"+"}</span></button>{projectId===p.id&&<div className="ln-project-detail"><strong>Next decision</strong><p>{p.next}</p><div className="ln-actions"><button onClick={()=>go("crew")}>Observe crew</button>{p.stage==="Editorial review"&&<button onClick={()=>go("reader")}>See article interaction demo</button>}</div><p className="ln-meta">Fixture only. No workflow execution or publication.</p></div>}</article>)}</section>}
        {screen==="crew"&&<>
          <div className="ln-actions ln-filter"><button aria-pressed={audience==="editor"} onClick={()=>setAudience("editor")}>Editor view</button><button aria-pressed={audience==="public"} onClick={()=>setAudience("public")}>Public view simulation</button><span className="ln-meta">{audience==="public"?"Private events hidden in this simulation.":"All illustrative editorial events."}</span></div>
          <div className="ln-crew-grid"><section className="ln-panel"><div className="ln-heading"><div><span className="ln-kicker">The crew at work</span><h2>Our collective expedition</h2></div><label>Origin <select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="all">All crew</option><option>Terraveler</option><option>External</option></select></label></div><div className="ln-people">{people.filter(p=>origin==="all"||p.origin===origin).map(p=><article className="ln-person" key={p.name}><button className="ln-person-head" aria-expanded={selectedPerson===p.name} onClick={()=>setSelectedPerson(selectedPerson===p.name?null:p.name)}><span className="ln-avatar"><Icon name={p.icon}/></span><div><h3>{p.name}</h3><span className="ln-meta">{p.role} · {p.origin}</span></div><span>›</span></button><span className="ln-state"><i/>{p.status}</span><p>{p.task}</p><span className="ln-meta">{p.project}</span><div className="ln-distinction"><Icon name="compass"/> {p.distinction}</div>{selectedPerson===p.name&&<div className="ln-person-detail"><p><strong>{p.approved}</strong> illustrative approved contributions</p><span className="ln-meta">Distinction based on sample approved work; no ranking or real account activity.</span></div>}</article>)}</div></section>{feed()}</div>
        </>}
        {screen==="reader"&&<article className="ln-reading ln-panel"><span className="ln-kicker">Illustrative reading excerpt · The Log</span><h2>The Endurance expedition</h2><p className="ln-standfirst">A note in the margin can become a new thread of historical research.</p>{passages.map((p,i)=><div className="ln-passage" key={i}><p>{p}</p><button type="button" className="ln-marginal" aria-label={"Leave note on paragraph "+(i+1)} aria-expanded={activePassage===i} onClick={()=>{setActivePassage(activePassage===i?null:i);setNoteBody("");}}><img src="/brand/terraveler-favicon.svg" width="30" height="30" alt=""/></button>{activePassage===i&&<form className="ln-note-form" onSubmit={submitNote}><label htmlFor={"note-"+i}>Leave a marginal note</label><blockquote>{p}</blockquote><textarea id={"note-"+i} autoFocus required maxLength={1200} value={noteBody} onChange={e=>setNoteBody(e.target.value)} placeholder="Suggest a correction, source or historical detail…"/><div className="ln-actions"><button className="ln-primary" type="submit" disabled={!noteBody.trim()}>Send sandbox note</button><button type="button" onClick={()=>setActivePassage(null)}>Cancel</button></div></form>}</div>)}<button onClick={()=>go("inbox")}>Open editorial inbox →</button></article>}
        {screen==="inbox"&&<section className="ln-panel"><div className="ln-heading"><h2>Reader contributions</h2><span className="ln-meta">{openNotes.length} open</span></div>{notes.map(n=><article className="ln-inbox-item" key={n.id}><span className="ln-kicker">{n.state==="open"?"Awaiting attention":"Resolved"} · Article note</span><blockquote>{n.quote}</blockquote><p>{n.body}</p><button onClick={()=>setNotes(old=>old.map(x=>x.id===n.id?{...x,state:x.state==="open"?"resolved":"open"}:x))}>{n.state==="open"?"Mark resolved":"Reopen"}</button></article>)}</section>}
        <footer className="ln-foot">Specimen laboratory · Session-only interactions; refresh resets all examples. Public view is an editorial preview, not a public endpoint.</footer>
      </main>
    </div>
  </div>;
}
