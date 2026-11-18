import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { newsroomPreviewEnabled } from "@/lib/newsroomPreview";
import PublicChartroom from "./PublicChartroom";
import "../../specimen/living-newsroom/living-newsroom.css";
import "../connected.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Chartroom — connected preview",robots:{index:false,follow:false}};
export default function Page(){
 if(!newsroomPreviewEnabled())notFound();
 return <PublicChartroom/>;
}
