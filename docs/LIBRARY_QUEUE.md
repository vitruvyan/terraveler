# The Library Queue — source reconnaissance for candidate voyages

What follows is not a wish list. Every source below was fetched and read
before it was written down: the URL returned 200, the licence was checked
against Magna Carta §3.2, and the text was searched for the two things the
ingestion pipeline actually needs — named landfalls and dates to attach them
to. A voyage is only as ingestible as its worst-documented leg, so the
verdicts are about the *source*, not about the voyage's importance.

Verified 2026-07-25. Re-check the URLs before a run: archive.org items are
sometimes re-scanned under a new identifier, and an item that was open can be
withdrawn into the lending collection.

## Why each entry names the exact edition

Three of the first source proposals for this queue were unusable, and in every
case the book was real, famous, and the wrong edition:

- Columbus's *Diario* — the proposed scan was Dunn & Kelley, University of
  Oklahoma Press, **1989**, `access-restricted-item: true`.
- Ibn Battuta — the proposed scan was a Cambridge UP reprint of **2012**,
  lending only, despite carrying an 1829 title.
- Pizarro — reported as having no public-domain source at all, when Markham's
  1872 Hakluyt Society translation has been open on archive.org for years.

An author dead six centuries says nothing about the copyright of the volume in
front of you; the translator, the editor and the scanning library each start
their own clock. So each entry below records the edition, its date, and — for
archive.org — the identifier whose metadata was actually inspected.

---

## Ready

These have a public-domain primary text with enough dated landfalls to run
`ingest/run.py` against.

### Magellan / Elcano, 1519–1522
- **Source:** Antonio Pigafetta, *The First Voyage Round the World*, trans.
  Lord Stanley of Alderley, Hakluyt Society, 1874.
- **URL:** https://www.gutenberg.org/cache/epub/74723/pg74723.txt (670 KB)
- **Nature:** first-hand. Pigafetta sailed the whole circumnavigation and was
  one of the eighteen who came home.
- **Itinerary:** ~40+ named landfalls with dates, from Sanlúcar to the Strait,
  the Pacific crossing, the Philippines and the return by the Cape.
- **To declare:** Magellan died at Mactan in 1521; the voyage is completed
  under Elcano, and the title should not imply otherwise.

### Columbus, first voyage 1492–1493 (and later voyages)
- **Source:** *The Northmen, Columbus and Cabot, 985–1503*, ed. Julius E.
  Olson & Edward G. Bourne, Original Narratives of Early American History,
  1906.
- **URL:** https://www.gutenberg.org/cache/epub/18571/pg18571.txt (983 KB)
- **Nature:** **not** Columbus's own journal — the ship's log is lost. What
  survives is Bartolomé de las Casas's abstract of it, which quotes Columbus
  in places and summarises him in others.
- **Itinerary:** dated day-by-day entries. Verified verbatim, 11 October 1492:
  *"The course was W.S.W., and there was more sea than there had been during
  the whole of the voyage. They saw sandpipers, and a green reed near the
  ship…"*
- **To declare:** every quote must be attributed to the Las Casas abstract,
  never presented as Columbus's own words verbatim. This is exactly the kind
  of distinction the `confidence` field and the citation line exist for.
- **Bonus:** the same volume carries the second voyage (Dr. Chanca), the third
  (Las Casas), the fourth, the Cabot documents and the Saga of Eric the Red.

### Jacques Cartier, 1534 / 1535–36 / 1541–42
- **Source:** *The Voyages of Jacques Cartier*, published from the originals
  with translations, notes and appendices by H. P. Biggar, Public Archives of
  Canada, Ottawa, 1924.
- **URL:** https://archive.org/download/voyagesofjacques0000cart_f4g3/voyagesofjacques0000cart_f4g3_djvu.txt (842 KB)
- **Identifier checked:** `voyagesofjacques0000cart_f4g3` — no access
  restriction, full text served.
- **Nature:** first-hand; Cartier wrote the relations himself, in the first
  person plural.
- **Itinerary:** dense. Marginal dates throughout (May 10, May 11, May 24,
  June 9, June 10, June 11, June 30, July 1…) against named landfalls —
  Bonavista 15×, Blanc Sablon 37×, Brion 26×, Anticosti 56×, Stadacona 34×,
  Hochelaga 129×, Saguenay 115×.
- **Note:** prefer this over the French Gutenberg texts (#23801, #12356), which
  are also public domain and also verified live, but cover only the first two
  voyages and would put the excerpts in a language the rest of the atlas does
  not use. Biggar gives all three voyages in English with the originals facing.
- **To declare:** the indigenous peoples of the St Lawrence appear only as
  Cartier observed them — their clothing, their canoes, their sealing. There
  is no Iroquoian voice in this source, and the log should say so rather than
  let the silence read as absence.

### Pizarro and the conquest of Peru, 1532–1533
- **Source:** *Reports on the Discovery of Peru*, trans. & ed. Clements R.
  Markham, Hakluyt Society, 1872. Contains Francisco de Xerez — Pizarro's own
  secretary — and Pedro Sancho.
- **URL:** https://archive.org/download/reportsondiscove00markrich/reportsondiscove00markrich_djvu.txt (360 KB)
- **Identifier checked:** `reportsondiscove00markrich` — no access restriction.
- **Nature:** first-hand. Xerez was present at Cajamarca.
- **Itinerary:** the volume opens with a dated chronological table — *1532 May
  16, Departure from Tumbez; 1532 May 24; 1533 Jan 5, Left Cassamarca, dined
  at Ychoca; 1533 May 3, melting of the gold and silver* — and the narrative
  carries the same dates inline. Place counts: Atabaliba 199×, Cuzco 121×,
  Caxamalca 60×, Pachacamac 36×, Tumbez 32×, Xauxa 27×.
- **Verified verbatim:** *"The Governor arrived at this town of Caxamalca on
  Friday, the 15th of November, 1532, at the hour of vespers."*
- **To declare:** Xerez is the conquest's own publicist, writing to justify it
  to the Crown. The Inca side of Cajamarca survives in this volume only as
  what Spaniards reported. Name that in the voyage summary.

---

## Caution — ingestible, but the gaps must be stated up front

### Marco Polo, 1271–1295
- **Source:** *The Travels of Marco Polo*, ed. Henry Yule, rev. Henri Cordier.
  Gutenberg #10636 (2.3 MB) and #10637 (392 KB), both live.
- **Problem:** not a log. Polo dictated to Rustichello da Pisa in a Genoese
  prison, decades after the fact, and the text is organised by place and
  wonder rather than by day. Roughly 10–15% of plausible stages will have no
  quotable excerpt, and few stages carry a date at all.
- **If run:** expect the itinerary planner to do more of the work than usual,
  and expect `date_note` to say "undated" often.

### Verrazzano, 1524
- **Source:** Henry Cruse Murphy, *The Voyage of Verrazzano*, 1875.
  https://www.gutenberg.org/cache/epub/5252/pg5252.txt (375 KB, verified)
- **Problem:** the volume contains the letter to Francis I in full English
  translation — inside a 300-page argument that the letter is a forgery.
  Modern scholarship has largely moved back toward authenticity, but the only
  whitelist-domain text we have is the one making the case against it.
- **If run:** attribute as "purportedly by Giovanni da Verrazzano", set
  confidence to contested, and say in the summary that the source volume
  disputes its own document. Coastal stops (Cape Fear northward to Cape
  Breton) are named but the dates are mostly modern reconstruction.

### Balboa and the crossing to the Pacific, 1513
- **Problem:** Oviedo, the fullest source, reached Darién in 1514 — the year
  *after* the crossing. 60–80% of stages would carry no excerpt.

### Ibn Battuta, 1325–1354
- **Source:** *The Travels of Ibn Batūta*, trans. Rev. Samuel Lee, Oriental
  Translation Committee, London, 1829.
- **URL:** https://archive.org/download/bub_gb_22IbAQAAMAAJ/bub_gb_22IbAQAAMAAJ_djvu.txt (803 KB)
- **Identifier checked:** `bub_gb_22IbAQAAMAAJ` — open. **Do not use**
  `travelsofibnbatu0000unse`: it carries the same 1829 title but is a
  Cambridge UP reprint of 2012 and is lending-restricted. **Do not use** the
  Gibb translation (1958–1994, Hakluyt Society) at all — in copyright.
- **Problem:** Lee worked from an abridged manuscript. Place coverage is real
  but thinner than the Rihla's reputation suggests (China 55×, Dehli 35×,
  Ceylon 26×, Bagdad 22×, Damascus 16×, Sumatra 13×), and dates are Hijri
  years (748, 736, 733, 729, 724, 703, 700) rather than a datable day-by-day
  itinerary.
- **If run:** declare the abridgement in the source citation, and expect to
  place stages by year, not by date.

---

## Thin — real voyages, but no source that can carry a log

- **Amerigo Vespucci.** Markham 1894 is public domain but yields only 5–8
  landfalls, and the authorship of the letters is itself disputed.
- **Bartolomeu Dias, 1487–88.** The Portuguese maritime archive burned in the
  Lisbon earthquake of 1755. What remains is João de Barros, writing some
  sixty years after the rounding. There is no journal to quote.
- **John Cabot, 1497.** No log survives. What we have are third-party letters
  — Pasqualigo, the two Soncino despatches — which are in Gutenberg #18571
  above, on a whitelist domain. Enough for a paragraph, not for an itinerary.
- **Zheng He, 1405–1433.** Ma Huan's *Yingya Shenglan* exists in English only
  in Mills's 1970 Hakluyt translation, which is in copyright. Fei Xin survives
  in English only inside Rockhill's 1914 scholarly synthesis, not as a
  standalone text. Both accounts are organised by country visited rather than
  by date. Revisit if a pre-1929 translation surfaces.

---

## Excluded

- **Kon-Tiki, 1947.** Thor Heyerdahl died in 2002; the 1948 book is in
  copyright everywhere that matters. Magna Carta §3.2 allows copyrighted work
  to be linked and briefly quoted, never ingested, and the pipeline ingests.
  Not a candidate under the present rules, and no amount of enthusiasm changes
  that.

---

## A shape for the ones without a log

Dias, Cabot, Balboa and Kon-Tiki fail for the same reason in three different
centuries: the route is historically certain and the first-hand narrative is
gone, unwritten, or locked. The atlas currently has one answer for that
situation — leave the voyage out — and it is the wrong answer for a project
whose whole claim is that it tells you what it does not know.

A second entry type ("routes without a log": the track, the certainty, and an
explicit statement of what was lost and when) would let these appear honestly
instead of silently. It is a schema and editorial decision, not an ingestion
one, so it is recorded here rather than acted on.

---

## Suggested order

Magellan, Columbus, Cartier, Pizarro — four voyages, all first-hand, all
densely dated, spanning 1492–1542 and three continents. That is roughly a
doubling of the atlas from sources already verified, before touching anything
that needs a caveat in the first sentence.
