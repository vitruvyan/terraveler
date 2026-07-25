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

## No surviving log — which is a fact about the archive, not about the voyage

An earlier draft of this file filed these under "thin" and recommended
deferring them. That was a category error, and it is worth naming so it is not
repeated.

Magna Carta §3 guarantees that Terraveler never invents a quotation. It does
not say that a voyage without quotations did not happen. Dias rounded the Cape;
Marco Polo reached the Yuan court; Cabot made a North Atlantic landfall. These
are taught in every school history because they are among the load-bearing
events of the period, and the atlas refusing to draw them would not be
rigour — it would be an archive's accident, silently promoted into an
editorial judgement about who mattered.

The right treatment is the opposite of omission: **draw the route, state its
precision honestly, and say what was lost and when.** That the Portuguese
maritime archive burned in the Lisbon earthquake of 1755 is not a disclaimer
to bury at the bottom of Dias's page. It is one of the most interesting facts
on that page.

- **Bartolomeu Dias, 1487–88.** No journal. The route survives through João de
  Barros, *Décadas da Ásia*, written some sixty years later from records that
  no longer exist. Landfalls approximate; the rounding itself certain.
- **John Cabot, 1497.** No log. Three contemporary letters by other hands —
  Pasqualigo, and the two Soncino despatches — all in Gutenberg #18571 above.
  Landfall location genuinely unresolved to this day; that dispute is content.
- **Marco Polo, 1271–1295.** See Caution above. Dictated to Rustichello
  decades later, arranged by wonder rather than by day.
- **Amerigo Vespucci.** Markham 1894 is public domain; 5–8 landfalls, and the
  authorship of the letters is itself contested.
- **Zheng He, 1405–1433.** Ma Huan's *Yingya Shenglan* exists in English only
  in Mills's 1970 Hakluyt translation, which is in copyright. Fei Xin survives
  in English only inside Rockhill's 1914 synthesis. Both are arranged by
  country visited rather than by date. The voyages are firmly dated by the Ming
  annals, so the route can be drawn even where the excerpts cannot: this
  belongs with Dias, not in the discard pile.

---

## Excluded

- **Kon-Tiki, 1947.** Thor Heyerdahl died in 2002; the 1948 book is in
  copyright everywhere that matters. Magna Carta §3.2 allows copyrighted work
  to be linked and briefly quoted, never ingested, and the pipeline ingests.
  Not a candidate under the present rules, and no amount of enthusiasm changes
  that.

---

## The foundation this queue is waiting on: `evidence_basis`

Confidence today lives on the waypoint (`certain` / `approximate`) and on the
excerpt (verbatim or null). Nothing declares *what kind of evidence the voyage
as a whole rests on*, so the log page renders every missing excerpt with the
same sentence — "No verified journal excerpt for this stage yet — help us find
one" — which reads as a to-do item. For Cook that is exactly right: the
journal exists, the gap is ours. For Dias it is false. There is no excerpt to
find. The archive burned.

One voyage-level field fixes this, and it improves voyages already published
rather than only admitting weak ones:

| `evidence_basis` | Means | Example |
|---|---|---|
| `contemporary-journal` | a first-hand log by the traveller survives | Cook, Cartier, Pigafetta, Darwin, Shackleton |
| `contemporary-testimony` | first-hand, but not the traveller's own log | Xerez on Pizarro; **Columbus**, which survives only as Las Casas's abstract |
| `later-chronicle` | written from sources now lost | Barros on Dias; Oviedo on Balboa |
| `reconstructed` | route established by modern scholarship from indirect evidence | Cabot; Zheng He's landfalls |

Plus one mandatory prose field, `what_was_lost`, naming the gap and its cause
in a sentence. Not a disclaimer — content.

Note what the second row does: **Columbus is already
`contemporary-testimony`.** The field is not a concession invented to let
weaker voyages in. It corrects an overstatement the atlas is making today about
one of its strongest entries.

Downstream, the log page's fallback sentence becomes conditional on the tier:
a `later-chronicle` stage should read *"Barros, writing c. 1552, places the
landfall here; no contemporary record survives"* — a fact, with its own
citation — instead of an invitation to go find a document that burned.

This is an editorial and schema decision, not an ingestion one. It is the
foundation the rest of this queue should be poured onto, and it should land
before the next batch of voyages, not after.

---

## Second wave — verified 2026-07-25

All URLs fetched, all archive.org identifiers checked for access restriction.

### Ready

- **Charles Darwin, HMS Beagle, 1831–36.** *The Voyage of the Beagle*,
  Gutenberg #944 (1.2 MB). First-hand, dated, and the densest itinerary of any
  candidate so far: Patagonia 92×, Tierra del Fuego 75×, Chiloé 56×, Bahia
  48×, Tahiti 44×, Valparaíso 33×, Galápagos 25×. It also changes the atlas's
  register — a voyage of observation rather than of conquest, and the only one
  where the cargo home was an idea.
- **Ernest Shackleton, *Endurance*, 1914–17.** *South*, Gutenberg #5199
  (866 KB). Shackleton died 1922, published 1919: public domain everywhere.
  Endurance 135×, Elephant Island 69×, South Georgia 67×, Weddell 62×. Worsley's
  navigation makes the positions unusually exact for a voyage with no ship.
- **Francis Drake, circumnavigation 1577–80.** *The World Encompassed by Sir
  Francis Drake*, Hakluyt Society 1854, identifier `worldencompassed16drak`,
  unrestricted (803 KB). Period orthography — search "Streights" (23×), not
  "Straits"; Magellan 28×, Julian 19×, Moluccas 8×, Celebes 8×. Compiled 1628
  by Drake's nephew from Francis Fletcher's notes, so `contemporary-testimony`,
  not `contemporary-journal`. Dates are given by year far more often than by
  day: expect a coarser itinerary than Cook's.

### Non-European, verified open

- **Faxian, China to India and Ceylon, 399–414.** James Legge trans., *A Record
  of Buddhistic Kingdoms*, 1886, Gutenberg #2124 (316 KB). First-hand and
  genuinely ancient, but short, and Legge's transliterations are Victorian
  (Khoten, Kie-cha) — the gazetteer will need help. `contemporary-journal`,
  thin. Caution.
- **Xuanzang, China to India, 629–645.** Samuel Beal trans., *Si-Yu-Ki:
  Buddhist Records of the Western World*, identifier
  `in.ernet.dli.2015.107447`, 1906 reprint, unrestricted. Longer and far
  richer than Faxian; the great overland Asian journey, and the strongest
  non-European candidate found.
- **Leo Africanus (al-Hasan al-Wazzan), North and West Africa, c. 1510–20.**
  Pory's 1600 English translation, ed. Robert Brown, Hakluyt Society 1896,
  identifier `historyanddescr02porygoog`, unrestricted. A Moroccan diplomat's
  Africa, described from inside it.
- **Ibn Battuta** — see Caution above. Lee 1829, `bub_gb_22IbAQAAMAAJ`.

### The Crusades

A different shape, and worth taking seriously for exactly that reason: not one
navigator on one ship, but several contingents leaving from different cities
and converging — which the current schema (one voyage, one navigator, one
ordered track) cannot express without distortion. That is a modelling question
to settle before ingestion, not during it.

The sources, however, are unusually good, and — uniquely among everything in
this file — **both sides wrote:**

- **August C. Krey, *The First Crusade: The Accounts of Eye-Witnesses and
  Participants*, Princeton 1921.** Identifier `firstcrusadeacco00krey`,
  unrestricted (955 KB). Antioch 222×, Jerusalem 175×, Nicaea 77×,
  Constantinople 71×, Edessa 18×, Ascalon 16×. Itinerary-shaped and datable.
  **Caveat: Latin eyewitnesses only** — no Muslim chronicler appears (Ibn
  al-Athir 0×), and Alexios (48×) is seen entirely through Frankish eyes.
- **Usama ibn Munqidh, *An Arab-Syrian Gentleman and Warrior in the Period of
  the Crusades*, trans. Philip Hitti, 1929.** Identifier
  `in.ernet.dli.2015.85347`, unrestricted. The Frankish presence from a Syrian
  nobleman's side. Published 1929, therefore public domain in the US; confirm
  the position for other jurisdictions before relying on it.
- **Villehardouin, *Memoirs or Chronicle of the Fourth Crusade and the Conquest
  of Constantinople*,** Gutenberg #6032. The Fourth Crusade, which never
  reached the Holy Land and sacked a Christian capital instead — the route
  itself is the argument.
- **Anna Komnene, *Alexiad*,** Elizabeth Dawes trans. 1928, identifier
  `alexiad-english-dawes-1928`, unrestricted. The Byzantine view, by a woman
  who watched the Franks arrive.

Krey plus Usama plus Komnene would be the first entry in the atlas where a
single track carries three mutually hostile contemporary accounts of the same
road. Nothing else in this queue can do that.

---

## Suggested order

1. **`evidence_basis` first.** It is a small change that makes every later
   entry honest and retroactively corrects Columbus. Pouring more voyages onto
   the current schema means re-ingesting them afterwards.
2. **Then Magellan, Columbus, Cartier, Pizarro, Darwin, Shackleton** — six
   voyages, all verified, all densely dated, spanning 1492–1917.
3. **Then Drake and Xuanzang**, which need the new field to be described
   accurately.
4. **Then Dias, Cabot, Zheng He** as `later-chronicle` / `reconstructed`,
   which is the whole point of building the field.
5. **The Crusades last**, after the multi-contingent modelling question is
   settled. Do not force them into the single-navigator schema.
