import { PLATES } from "./plates";
import { illuminationBackgrounds } from "./voyageIllustrations";
import { editorialCoverSubjects, wallCoverFor } from "./editorialWallArtwork";
import { availableWallArtwork } from "./editorialWallArtworkGenerated";
import {CREW_PORTRAITS,crewPortraitFor} from "./editorialCrewPortraits";

export type AlbumKind = "artwork" | "cartography" | "photography";
export type AlbumEntry = {
 id:string; title:string; kind:AlbumKind; collection:string;
 src:string|null; alt:string; credit:string; date:string; license:string;
 source?:string; use:string; caution:string; state:"available"|"pending"|"reference-only";
};
const engravingFamilies = [
 ["atlas-cartography","Atlas & cartography","Engraved geographic motifs, navigation instruments and vessels."],
 ["mythic-seas","Mythic seas & allegories","Engraved maritime myths, winds, ruins and allegorical figures."],
 ["new-worlds","New worlds & American imaginaries","Engraved cultural, architectural and landscape motifs."],
 ["mariners","Mariners, captains & roles","Engraved figures representing shipboard roles."],
] as const;
export const VISUAL_ALBUM: readonly AlbumEntry[] = [
 ...CREW_PORTRAITS.map((p):AlbumEntry=>({id:"crew-"+p.key,title:p.title,kind:"artwork",collection:"Living Crew · engraved portraits",src:crewPortraitFor(p.key)?.src??null,alt:p.alt,credit:"Terraveler original · AI-generated",date:"2026",license:"Internal editorial artwork",use:"Editorial persona identification and reference",caution:"Imaginary editorial persona, not an authentic historical likeness or evidence.",state:crewPortraitFor(p.key)?"available":"pending"})),
 ...editorialCoverSubjects.map((s):AlbumEntry=>{
   const ready=availableWallArtwork.includes(s.key);
   return {id:"wall-"+s.key,title:s.title,kind:"artwork",collection:"Editorial Wall · colour series",
    src:ready?wallCoverFor(s.title).src:null,alt:s.alt,credit:"Terraveler original · AI-generated",date:"2026",
    license:"Internal editorial artwork",use:"Editorial proposals and thematic covers",
    caution:"Interpretive illustration, not a documented scene or historical source.",state:ready?"available":"pending"};
 }),
 ...Object.values(PLATES).map((p):AlbumEntry=>({
   id:"plate-"+p.url.split("/").pop(),title:p.caption.split(" — ")[0],kind:"cartography",collection:"Historical chart collection",
   src:p.url,alt:p.caption,credit:p.credit,date:p.date,license:p.license,source:p.source_url,
   use:"Chapter opening and contextual cartography",caution:"Consult the source record and verify relevance to the particular journey before reuse.",state:"available"
 })),
 ...engravingFamilies.map(([id,title,alt]):AlbumEntry=>({id:"engraving-"+id,title,kind:"artwork",collection:"Illustration specimen · original engraving sheets",
   src:"/media/specimen-illustration/"+id+".webp",alt,credit:"Terraveler original · generated",date:"Not recorded in catalog",license:"Internal editorial artwork",
   use:"Motifs, chapter openings and editorial reference",caution:"A sheet of imaginative motifs; not primary historical evidence.",state:"available"})),
 ...Object.entries(illuminationBackgrounds).map(([id,g]):AlbumEntry=>({id:"ground-"+id,title:g.title,kind:"artwork",collection:"Voyage illumination · original page grounds",
   src:g.src,alt:g.alt,credit:g.origin,date:"2026",license:"Internal editorial artwork",use:g.use,caution:g.caution,state:"available"})),
 {id:"photo-motupe",title:"Motupe · research image",kind:"photography",collection:"Research references",
   src:"/media/research/motupe.jpg",alt:"Research image catalogued under Motupe",credit:"Not recorded here",date:"Not recorded here",license:"Not verified in this catalog",
   use:"Internal inspection only",caution:"Do not reuse or publish before identifying the source, date, creator and rights. Filename alone is not proof of subject.",state:"reference-only"},
];
