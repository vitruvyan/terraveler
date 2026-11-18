import { availableWallArtwork } from "./editorialWallArtworkGenerated";

export type WallCover = {
  src: string; alt: string; label: string; credit: string;
  kind: "artwork" | "context-map"; tone: "gold" | "sage" | "rose" | "blue";
  source?: string;
};
const original = "/media/editorial-wall/";
const context: WallCover = {
  src: "/media/voyage-illumination/marine-chart-vertical.webp",
  alt: "Invented maritime chart with a compass and coasts",
  label: "Cartographic motif · not historical evidence",
  credit: "Terraveler original · generated 2026", kind: "artwork", tone: "gold"
};
const fraMauro:WallCover = {
  src:"/login-backgrounds/fra-mauro-map.jpg",alt:"Detail of Fra Mauro's medieval world map",
  label:"Contextual cartography · not evidence for this proposal",credit:"Fra Mauro · world map, c. 1450 · public domain",
  kind:"context-map",tone:"blue",source:"https://commons.wikimedia.org/wiki/File:FraMauroDetailedMap.jpg"
};
const ortelius:WallCover = {
  src:"/login-backgrounds/ortelius-world-map-1570.jpg",alt:"Abraham Ortelius's printed world map",
  label:"Contextual cartography · not the work of Piri Reis",credit:"Abraham Ortelius · Typus Orbis Terrarum, 1570 · public domain",
  kind:"context-map",tone:"rose",source:"https://commons.wikimedia.org/wiki/File:OrteliusWorldMap1570.jpg"
};
export const editorialCoverSubjects = [
  { key:"zheng-he",title:"The voyages of Zheng He",match:/\bzheng\s+he\b/i,alt:"Illustrated Ming-era sailing ships approaching an Indian Ocean port",tone:"blue",fallback:fraMauro },
  { key:"aksum",title:"The kingdom of Aksum",match:/\b(?:aksum|axum|aksumite)\b/i,alt:"Interpretive landscape of the Aksumite highlands and stone stelae",tone:"sage",fallback:{...context,tone:"sage"} },
  { key:"ibn-battuta",title:"In the footsteps of Ibn Battuta",match:/\bibn[\s-]+batt(?:u|ū|ou)ta\b/i,alt:"Interpretive scene of a medieval caravan crossing North Africa",tone:"gold",fallback:{...fraMauro,tone:"gold"} },
  { key:"piri-reis",title:"The maps of Piri Reis",match:/\bpiri[\s-]+reis\b/i,alt:"Interpretive scene of an Ottoman cartographer examining a sea chart",tone:"rose",fallback:ortelius },
] as const;
/** Editorial-only decoration, never a claim about the historical record. No
 * external image URLs are chosen from submissions, and unmatched topics retain
 * a deliberately generic Terraveler motif. */
export function wallCoverFor(title: string): WallCover {
  const matches=editorialCoverSubjects.filter(s=>s.match.test(title.normalize("NFKC")));
  if(matches.length!==1)return context;
  const subject=matches[0];
  if(!availableWallArtwork.includes(subject.key))return subject.fallback;
  return {src:original+subject.key+".webp",alt:subject.alt,label:"Editorial artwork · AI-generated interpretation",credit:"Terraveler original · 2026",kind:"artwork",tone:subject.tone};
}
