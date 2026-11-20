import {EDITORIAL_PERSONAS} from "./editorialPersonas";
import {availableCrewPortraits} from "./editorialCrewPortraitsGenerated";
export const CREW_PORTRAITS = EDITORIAL_PERSONAS.map(p=>({key:p.key,title:p.name+" · "+p.title,alt:"Original engraved persona portrait of "+p.name,src:"/media/editorial-crew/"+p.key+".webp"}));
export function crewPortraitFor(key:string){
 return availableCrewPortraits.includes(key)?CREW_PORTRAITS.find(p=>p.key===key)??null:null;
}
