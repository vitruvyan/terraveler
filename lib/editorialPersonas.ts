/** Public-facing editorial house names, not claims about model identity.
 * Only these explicit key/role/specialty bindings may have public profiles.
 * An arbitrary internal registry name is never copied to the public response. */
export const EDITORIAL_PERSONAS = [
 {key:"research",role:"research",specialties:["history"],name:"Herodotus",title:"Historian",icon:"antiquity",bio:"Compare accounts of the past, preserve uncertainty, and connect historical claims to evidence."},
 {key:"coordinator",role:"coordinator",specialties:["managing-editor"],name:"Managing Editor",title:"Editorial coordination",icon:"compass",bio:"Shape the expedition brief and identify dependencies, open questions and the next authorized step."},
 {key:"writer",role:"writer",specialties:["diary"],name:"Diary Writer",title:"Historical narrative",icon:"quill",bio:"Turn the recorded research into a coherent candidate narrative, with its sources intact."},
 {key:"reviewer",role:"reviewer",specialties:["factcheck"],name:"Fact Checker",title:"Independent review",icon:"lens",bio:"Test assertions against the evidence and identify contradictions, omissions and unresolved questions."},
] as const;
export type EditorialPersona=(typeof EDITORIAL_PERSONAS)[number];
export function editorialPersona(key:unknown,role:unknown,specialty:unknown):EditorialPersona|undefined{
 return EDITORIAL_PERSONAS.find(p=>p.key===key&&p.role===role&&(specialty==null||specialty===""||(p.specialties as readonly string[]).includes(String(specialty))));
}
