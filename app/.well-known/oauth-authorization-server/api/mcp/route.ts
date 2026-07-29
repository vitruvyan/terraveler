export { GET } from "../../route";

/**
 * RFC 8414 with the resource path inserted, for the same reason as its
 * protected-resource sibling: a client that derives the metadata address from
 * the URL it was given looks here, and a 404 ends the discovery it was in the
 * middle of.
 */
