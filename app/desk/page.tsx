import LegacyDesk from "./LegacyDesk";
import SiteHeader from "@/components/SiteHeader";
import LiveDesk from "../living-newsroom/live/LiveDesk";
import {newsroomReleaseEnabled,useNewsroomLanding} from "@/lib/newsroomRelease";
import "../specimen/living-newsroom/living-newsroom.css";
import "../living-newsroom/connected.css";
export const dynamic="force-dynamic";
type Params=Record<string,string|string[]|undefined>;
export default async function DeskPage({searchParams}:{searchParams:Promise<Params>}){
 const params=await searchParams;
 if(useNewsroomLanding("desk",params))return <><SiteHeader/><LiveDesk release chartroomReleased={newsroomReleaseEnabled("chartroom")}/></>;
 return <LegacyDesk/>;
}
