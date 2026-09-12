/* Where the atlas can take you, written once.
 *
 * It was written three times: in SiteHeader, and again in each of the two map
 * experiences, which built the same compass menu separately. Two reforms then
 * passed the map by — `20f321a` took Search out of the navigation on the
 * argument that searching is an action rather than a destination, and
 * `c1cb205` added the crew's watch bill — and neither reached the maps,
 * because nobody knew there were two more copies to change. The map menu has
 * been offering a door the site retired and hiding one the site added.
 *
 * A destination list is not layout, so it does not belong to whichever shell
 * happens to draw it. test/layout.test.ts checks the two shells still agree.
 */

export type Destination = { href: string; label: string };

/* Named because more than the menu needs them. Searching is an action, not a
   destination — but it has to LAND somewhere, and that somewhere is the atlas.
   Written out by hand it would break in silence the day the atlas moved. */
export const ABOUT: Destination = { href: "/about", label: "About" };
export const HOW_IT_WORKS: Destination = { href: "/how-it-works", label: "How it works" };
export const ATLAS: Destination = { href: "/voyages", label: "The Atlas" };
export const CHARTROOM: Destination = { href: "/contribute", label: "The Chartroom" };
/** @deprecated Use CHARTROOM; the href remains stable for existing links. */
export const CONTRIBUTE = CHARTROOM;
export const CREW: Destination = { href: "/crew", label: "The crew" };
export const MAGNA_CARTA: Destination = { href: "/magna-carta", label: "The Magna Carta" };

/** What the site IS, and how to take part. */
export const PRIMARY: Destination[] = [ABOUT, HOW_IT_WORKS, ATLAS, CHARTROOM];

/** Read once, not every visit — behind a disclosure in the header. */
export const PROJECT: Destination[] = [CREW, MAGNA_CARTA];

/** Every door, in reading order. The map's compass menu is flat and takes all. */
export const ALL: Destination[] = [...PRIMARY, ...PROJECT];
