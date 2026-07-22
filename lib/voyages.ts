/** The atlas index — one entry per published voyage. Used by the map's
 *  voyage picker, the cartouche, and the /voyages page. */
export interface AtlasEntry {
  slug: string;
  href: string;
  title: string;
  navigator: string;
  years: string;
  blurb: string;
}

export const ATLAS: AtlasEntry[] = [
  {
    slug: "boudeuse-1766",
    href: "/",
    title: "The First French Circumnavigation of the Globe",
    navigator: "Louis-Antoine de Bougainville",
    years: "1766–1769",
    blurb:
      "Around the world for France: fifty-two days in Magellan's strait, Tahiti named New Cythera, hunger in the Louisiades — and home with only seven men lost.",
  },
  {
    slug: "boussole-1785",
    href: "/voyage/boussole-1785",
    title: "The Voyage of La Pérouse",
    navigator: "Jean-François de Galaup, comte de La Pérouse",
    years: "1785–1788",
    blurb:
      "France's answer to Cook: Alaska to Kamchatka to Botany Bay — then silence, and the secret of the sea solved at Vanikoro forty years on.",
  },
];
