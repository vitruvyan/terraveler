import {wallCoverFor} from "@/lib/editorialWallArtwork";
export default function WallArtwork({title}:{title:string}){
 const cover=wallCoverFor(title);
 return <figure className="ln-wall-art" data-art-tone={cover.tone}>
   <img src={cover.src} alt={cover.alt} loading="lazy" decoding="async" width={768} height={512}/>
   <figcaption><span>{cover.label}</span>{cover.source?<a href={cover.source} target="_blank" rel="noreferrer">{cover.credit} ↗</a>:<span>{cover.credit}</span>}</figcaption>
 </figure>;
}
