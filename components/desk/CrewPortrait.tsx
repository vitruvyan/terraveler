"use client";
import {useState} from "react";
import Icon,{type IconName} from "@/components/Icon";
import {crewPortraitFor} from "@/lib/editorialCrewPortraits";
export default function CrewPortrait({personaKey,icon}:{personaKey:string;icon:IconName}){
 const [failed,setFailed]=useState(false);
 const portrait=crewPortraitFor(personaKey);
 return portrait&&!failed?<img className="ln-crew-portrait" src={portrait.src} alt={portrait.alt} width={160} height={160} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<Icon name={icon}/>;
}
