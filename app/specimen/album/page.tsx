import type {Metadata} from "next";
import Chapters from "../Chapters";
import BackToTop from "../BackToTop";
import {VISUAL_ALBUM} from "@/lib/visualAlbum";
import Album from "./Album";
import "../specimen.css";
import "./album.css";
export const metadata:Metadata={title:"Visual album · Terraveler",robots:{index:false,follow:false}};
export default function Page(){
 return <div className="spec va-album"><main className="spec-sheet va-sheet"><Chapters current="/specimen/album"/><header className="va-mast"><span className="spec-eyebrow">IX · the editorial image library</span><h1>The visual album</h1><p className="spec-lede">A collection of images through which the atlas finds its visual voice.</p><p>Original artwork, historical cartography and research photographs in one internal reference catalogue. An illustration evokes; a historical plate has provenance. Neither is automatically evidence for a particular passage.</p><a href="/specimen/illustration">Illustration specimen ↗</a></header><Album entries={VISUAL_ALBUM}/><footer className="va-foot">Internal reference catalogue · repository-managed assets · no publication or upload controls. The source register remains authoritative for historical evidence.</footer><BackToTop/></main></div>;
}
