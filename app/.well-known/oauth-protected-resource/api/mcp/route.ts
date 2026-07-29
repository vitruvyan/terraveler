export { GET } from "../../route";

/**
 * The same metadata, at the address RFC 9728 actually specifies.
 *
 * For a protected resource at https://host/api/mcp, the metadata document lives
 * at https://host/.well-known/oauth-protected-resource/api/mcp — the resource's
 * path is inserted after the well-known segment. Only the root form was served,
 * so a client following the specification asked for this and got a 404, then
 * had nothing to follow.
 *
 * The root form stays, because clients that assume it exist too. Serving both
 * costs one re-export.
 */
