/** Server-only release switches. Preview routes keep their separate gate.
 * No public-facing feature is activated by merging the release candidate.
 * Explicit legacy query URLs always take precedence over a new landing. */
export type NewsroomSurface="desk"|"chartroom";
type Env=Record<string,string|undefined>;
export function newsroomReleaseEnabled(surface:NewsroomSurface,env:Env=process.env){
 return env[surface==="desk"?"TERRAVELER_NEWSROOM_DESK":"TERRAVELER_CHARTROOM_V2"]==="1";
}
export function newsroomPreviewEnvironment(env:Env=process.env){
 return env.VERCEL_ENV==="preview"||env.NODE_ENV==="development";
}
export function newsroomReadEnabled(surface:NewsroomSurface,env:Env=process.env){
 return newsroomPreviewEnvironment(env)||newsroomReleaseEnabled(surface,env);
}
export function useNewsroomLanding(surface:NewsroomSurface,params:Record<string,string|string[]|undefined>,env:Env=process.env){
 return newsroomReleaseEnabled(surface,env)&&Object.keys(params).length===0;
}
