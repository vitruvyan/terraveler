"""Terraveler voyage Extractor — Axis graph, run per voyage_slug.

    python extract.py --voyage cook-1768

Nodes: plan_itinerary -> extract -> geocode -> verify -> assemble.
Turns a voyage's pgvector text corpus (rag_docs) into a DRAFT submission
JSON in the submission_laperouse.json shape (meta + voyage + waypoints[].
claims[].evidence{quote, excerpt, source_url, source_title, license}).

Source integrity is non-negotiable: a diary_excerpt is either a VERBATIM
contiguous span re-verified against the live source text, or it is null.
Never fabricated, never paraphrased-then-passed-off-as-quote.

This script does NOT touch Supabase, the frontend, or anything public. It
only reads rag_docs / writes a submission JSON + a trace JSON.

------------------------------------------------------------------------
Design note (2026-07-23): itinerary PLANNING, not DISCOVERY.

The original version of this script tried to *discover* the itinerary by
outlining every PD chunk with an LLM (batch by batch) and then clustering
the resulting candidates into a canonical waypoint list. That approach
systematically favored densely-documented legs (whichever places got the
most journal chunks devoted to them) and dropped or scrambled the sparser
legs, because clustering/tie-breaking only ever sees candidates that
survived the outline pass, with no notion of "this voyage MUST include a
departure port and a return leg even if they're each only a few chunks".

`plan_itinerary_node` replaces outline+skeleton with a single planning
call: it shows the model the voyage's title/summary plus a SCATTERED
sample of chunks spanning the *entire* narrative chunk_index range (not
just the densest section), and asks for the canonical, ordered, complete
list of major stops — explicitly requiring a departure port and a
return/home leg. Which stops a well-documented historical voyage visited,
and in what order, is settled historical fact; letting the model propose
that list (grounded in a real span-covering sample, not vibes) is fine.
The per-stop grounding (retrieve -> extract -> geocode -> verify) is
UNCHANGED and remains the only thing allowed to touch diary_excerpt/quote
text — plan_itinerary never sees or produces a quote.
"""
import os
import re
import io
import sys
import json
import math
import time
import argparse
import unicodedata
import urllib.request
import urllib.error
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from axis import GraphState, Runner, Policy
from axis.state import Fact, Decision, Rejection

import fetch as F
import oculus

KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
EXTRACT_MODEL = os.getenv("EXTRACT_MODEL", "claude-sonnet-5")
PLAN_MODEL = os.getenv("PLAN_MODEL", EXTRACT_MODEL)
UA = "terraveler-extract/0.1 (contact: dbaldoni@gmail.com)"

# The Carta a draft is produced under. Stamped into every submission, and the
# MCP gate rejects a draft whose version does not match its own — which is
# correct, and is why this must not drift.
#
# It drifted anyway. The Carta was amended to v0.3 (evidence basis, §3.6) while
# app/api/mcp/route.ts still said "0.2" and this file still stamped "0.1", so
# three places disagreed about which constitution was in force and every draft
# this pipeline produced would have been refused at the gate. test/carta.test.ts
# now fails the build if the three ever separate again.
CARTA_VERSION = "0.4"

# What kind of record a voyage survives through. Mirrors lib/evidence.ts and
# the check constraint in supabase/evidence_basis.sql — keep the three in step.
#
# This is required of every voyage, and validated before the graph runs rather
# than at assembly time, so a missing declaration costs a second instead of an
# hour of model calls. The point is that it must be decided by a person, up
# front: it is the difference between "we haven't pulled this passage yet" and
# "the records burned in 1755", and the log page says different things to the
# reader depending on the answer.
EVIDENCE_BASES = (
    "contemporary-journal",    # the traveller's own log survives
    "contemporary-testimony",  # first-hand, but not the traveller's log
    "later-chronicle",         # written afterwards, from sources now lost
    "reconstructed",           # no narrative source; route from indirect evidence
)

VOYAGE_META = {
    "cook-1768": {
        "title": "The First Voyage of Captain James Cook (1768-1771)",
        "navigator": "Lieutenant James Cook",
        "ships": "HM Bark Endeavour",
        "sponsor": "Royal Society (Transit of Venus observation) & the Admiralty, "
                   "under secret instructions from King George III",
        "summary": "Cook's first voyage: from Plymouth round Cape Horn to Tahiti "
                    "to observe the Transit of Venus, west through the Society "
                    "Islands to become the first European expedition to "
                    "circumnavigate and chart New Zealand, on to the uncharted "
                    "east coast of New Holland (Australia) — including a near-wreck "
                    "on the Great Barrier Reef and repairs at the Endeavour River — "
                    "then home by way of Batavia, the Cape of Good Hope, and "
                    "St Helena to England.",
        "date_window": (1768, 1771),
        "evidence_basis": "contemporary-journal",
        "what_was_lost": "Cook's journal survives complete. What is absent is "
                         "the other side of every encounter in it: the Māori, "
                         "Aboriginal Australian and Pacific Islander peoples he "
                         "met kept no written records, and their own accounts of "
                         "these meetings were not collected until long "
                         "afterwards, if at all.",
        # rag_docs' primary journal source for this voyage is the Wharton 1893
        # edition ("Captain Cook's Journal During His First Voyage Round the
        # World", Project Gutenberg ebook 8106) — the FULL first-voyage journal,
        # Plymouth departure through Australia/Batavia/the Cape to the return
        # anchorage in the Downs. chunk_index is PER-SOURCE (restarts at 0 for
        # every distinct rag_docs title/source_url — the corpus also holds a
        # handful of Wikipedia articles, each with their own 0-based
        # chunk_index, which the 'public domain' license filter below already
        # excludes). This book's own front matter (publisher's preface + table
        # of contents + an editorial aside that strays into 2nd/3rd-voyage
        # sailing dates) runs chunk_index 0-195; the journal narrative proper
        # runs 196-2113 ("CHAPTER 1. ENGLAND TO RIO JANEIRO." at chunk 198,
        # through the return to the Downs / journey home to London at chunk
        # 2107); the back-of-book alphabetical INDEX runs 2114-2130. Confirmed
        # by direct inspection of the corpus rows (2026-07-23).
        "narrative_chunk_range": (196, 2113),
    },
    "cortes-1519": {
        "title": "The Conquest of Mexico by Hernán Cortés (1519-1521)",
        "navigator": "Hernán Cortés",
        "ships": "the Spanish expedition and its Tlaxcalan and indigenous allies",
        "sponsor": "sailing from Cuba, then acting in the name of King Charles I of Spain",
        "summary": "Cortés's march on the Aztec empire: the landing near Veracruz, "
                   "the alliance with Tlaxcala and the massacre at Cholula, the entry "
                   "into Tenochtitlan and the seizure of Moctezuma, the disastrous "
                   "retreat of La Noche Triste, the victory at Otumba, and the final "
                   "siege and fall of Tenochtitlan in 1521.",
        "date_window": (1519, 1521),
        # Was contemporary-testimony while Bernal Díaz was the only source. With
        # MacNutt's translation of the Cartas de Relación in the corpus, Cortés's
        # own despatches — written during the campaign and sent to Charles V —
        # are now the primary, which is the journal tier by any honest reading.
        "evidence_basis": "contemporary-journal",
        "what_was_lost": "Cortés wrote his despatches during the campaign, to "
                         "the emperor whose permission he did not have, while "
                         "under charges from the governor who had sent him and "
                         "then tried to recall him. They are an account and a "
                         "legal defence at once, and they are silent wherever "
                         "silence served him. Bernal Díaz, a soldier who was "
                         "there, set down his own version four decades later in "
                         "old age, partly to correct historians he thought had "
                         "flattered Cortés — so the two disagree, and the atlas "
                         "carries both. Against them there is almost nothing: "
                         "the Mexica side survives only in compilations made "
                         "after the conquest, under Spanish supervision, and the "
                         "codices that were not made for Spaniards were burned.",
        # Multi-volume primary source (Bernal Díaz's Memoirs, Vols I & II): chunk_index
        # restarts per volume, so no single narrative range applies — defaults to the
        # whole PD span; per-stop pgvector retrieval + the canonical-itinerary plan
        # carry completeness across both volumes.
    },

    # -----------------------------------------------------------------------
    # The second wave. Sources verified in docs/LIBRARY_QUEUE.md; the licence
    # is re-checked at fetch time by whitelist.verify_source().
    #
    # None of these carries a narrative_chunk_range yet: the range can only be
    # set by reading the corpus rows after the first load, which is how Cook's
    # was established. Until then the whole PD span is used, and per-stop
    # pgvector retrieval plus the canonical-itinerary plan carry completeness —
    # the same arrangement Cortés runs under. Calibrate after the first run:
    #   select chunk_index, left(content, 90) from documents
    #    where voyage = '<slug>' order by chunk_index limit 40;
    # -----------------------------------------------------------------------

    "magellan-1519": {
        "title": "The First Circumnavigation: Magellan and Elcano (1519-1522)",
        "navigator": "Ferdinand Magellan",
        "ships": "Trinidad, San Antonio, Concepción, Victoria and Santiago",
        "sponsor": "sailing from Sanlúcar de Barrameda for King Charles I of Spain",
        "summary": "The first voyage to circle the world: south along the Brazilian "
                   "coast, the mutiny at Port San Julián, the passage of the strait "
                   "that now carries Magellan's name, ninety-eight days of open "
                   "Pacific, the Philippines and Magellan's death at Mactan, and the "
                   "return of a single ship under Juan Sebastián Elcano.",
        "date_window": (1519, 1522),
        # Calibrated against the corpus (2026-07-26). 1,022 public-domain chunks
        # from Gutenberg #74723. The Stanley volume is a COMPILATION, not
        # Pigafetta alone: chunks 0-172 are the title page, the dedication, the
        # contents and Stanley's own long introduction on Magellan's motives;
        # 173 opens the Genoese pilot's "Navigation and voyage which Fernando de
        # Magalhães made from Seville"; Pigafetta's own account begins at 255
        # ("I have reduced into this small book"); further testimonies follow,
        # including the Portuguese companion of Odoardo Barbosa at 241 and
        # Gaspar Correa. Footnotes run from 1010 to the Gutenberg boilerplate.
        #
        # Quotes may therefore come from any of several eyewitnesses rather than
        # from Pigafetta alone. That is legitimate — all are contemporary — but
        # the citation must name whose words they are, which the source_title
        # cannot do for a compilation. Worth an editorial pass before publishing.
        "narrative_chunk_range": (173, 1009),
        "evidence_basis": "contemporary-journal",
        "what_was_lost": "Pigafetta kept his journal throughout, but his own "
                         "manuscript is gone; the account survives in four early "
                         "copies that disagree with one another. Of roughly 260 men "
                         "who sailed, eighteen came home, and none of the dead left a "
                         "word. Lapulapu, who defeated and killed Magellan at Mactan, "
                         "appears only as his enemies described him.",
    },

    "columbus-1492": {
        "title": "The Voyages of Christopher Columbus (1492-1504)",
        "navigator": "Christopher Columbus",
        "ships": "Santa María, Pinta and Niña, and the fleets of the later voyages",
        "sponsor": "sailing from Palos de la Frontera for the Crown of Castile",
        "summary": "The crossing of 1492 and the three voyages that followed: the "
                   "landfall at Guanahaní, the coasts of Cuba and Hispaniola, the "
                   "wreck of the Santa María and the garrison left at La Navidad, and "
                   "the return voyages that turned a discovery into a colony.",
        "date_window": (1492, 1504),
        # Calibrated against the corpus (2026-07-27). Olson & Bourne 1906, Gutenberg #18571, 1,512 PD chunks. The volume opens with the Norse sagas and the Greenland documents — a different voyage entirely — and the Columbus material begins around 300, after the editors' notes on the translations. 1509-1511 is Gutenberg boilerplate.
        # The excerpts are Las Casas's abstract, not Columbus's own log: see
        # what_was_lost. Attribution must say so.
        "narrative_chunk_range": (300, 1508),
        # The log is lost. What survives is Las Casas's abstract of it, and the
        # atlas must not present those words as Columbus's own.
        "evidence_basis": "contemporary-testimony",
        "what_was_lost": "Columbus's log is lost — both the original and the copy "
                         "made for him. What survives is Bartolomé de las Casas's "
                         "abstract, written half a century later, quoting in places "
                         "and summarising in others, so even the most famous "
                         "sentences reach us at one remove. The Taíno who met the "
                         "ships left no written record, and within two generations "
                         "disease and forced labour had destroyed the society that "
                         "might have preserved one.",
    },

    "cartier-1534": {
        "title": "Jacques Cartier and the St Lawrence (1534-1542)",
        "navigator": "Jacques Cartier",
        "ships": "La Grande Hermine and the ships of three voyages from Saint-Malo",
        "sponsor": "sailing from Saint-Malo for King Francis I of France",
        "summary": "Three voyages into the Gulf of St Lawrence and up the river: the "
                   "cross raised at Gaspé, the winter at Stadacona and the scurvy that "
                   "was cured by an Iroquoian remedy, the journey to Hochelaga beneath "
                   "the mountain Cartier named Mont Royal, and the failed colony of "
                   "Charlesbourg-Royal.",
        "date_window": (1534, 1542),
        # Calibrated against the corpus (2026-07-27). Biggar 1924 via archive.org, 1,381 PD chunks. Front matter 0-11: the library stamp, title page, plate list and the editor's bibliographic notes. Index 1376-1379; 1380 is the library's date-due slip, scanned with the book.
        # KNOWN LIMITATION: this edition prints the French original and the
        # English translation on facing pages and the corpus interleaves them —
        # about 975 English chunks against 365 French. A range cannot separate
        # them and Carta 4 wants English, so quotes need a language check
        # before this voyage is published.
        "narrative_chunk_range": (12, 1375),
        "evidence_basis": "contemporary-journal",
        "what_was_lost": "Cartier wrote the relations of the first two voyages "
                         "himself; the third survives only through Hakluyt's English "
                         "translation of an original now lost. The St Lawrence "
                         "Iroquoians who met him left no account — not Donnacona, whom "
                         "Cartier carried to France where he died, nor the people of "
                         "Stadacona and Hochelaga, who had vanished from the valley "
                         "before Champlain arrived sixty years later, for reasons no "
                         "surviving document explains.",
    },

    "pizarro-1532": {
        "title": "Pizarro and the Fall of Tawantinsuyu (1532-1533)",
        "navigator": "Francisco Pizarro",
        "ships": "the expedition from Panama, landing at Tumbes",
        "sponsor": "acting under royal capitulation for King Charles I of Spain",
        "summary": "The march inland from Tumbes to Cajamarca, the ambush and capture "
                   "of Atahualpa in the square, the ransom room filled with gold and "
                   "silver from Cusco and Pachacamac, Atahualpa's execution, and the "
                   "advance on Cusco through Jauja.",
        "date_window": (1532, 1533),
        # Calibrated against the corpus (2026-07-27). Markham 1872 via archive.org, 495 PD chunks. Front matter 0-19: Hakluyt plates, contents, and Markham's introduction with its footnotes. Xerez's narrative is well under way by 128. Chunk 494 is the Berkeley library's circulation slip.
        "narrative_chunk_range": (20, 492),
        "evidence_basis": "contemporary-testimony",
        "what_was_lost": "Francisco de Xerez was Pizarro's secretary and stood in the "
                         "square at Cajamarca, but he wrote to justify the conquest to "
                         "the Crown that had licensed it. Against that there is almost "
                         "nothing: the Inca kept records on khipu rather than in "
                         "script, the khipu of Tawantinsuyu were destroyed, and "
                         "Atahualpa's account of his own capture does not exist in any "
                         "form.",
    },

    "darwin-1831": {
        "title": "The Second Voyage of HMS Beagle (1831-1836)",
        "navigator": "Charles Darwin",
        "ships": "HMS Beagle, under Robert FitzRoy",
        "sponsor": "sailing from Plymouth on an Admiralty survey of South America",
        "summary": "A survey voyage that became something else: the Brazilian forest, "
                   "the fossil beds of Patagonia, Tierra del Fuego and the returning "
                   "of three Fuegians taken to England, the earthquake at Concepción, "
                   "the Galápagos, Tahiti, New Zealand, Australia and the coral atolls "
                   "of the Keeling Islands.",
        "date_window": (1831, 1836),
        # Calibrated against the corpus after the first load (2026-07-26).
        # 1996 public-domain chunks from Gutenberg #944. Front matter runs 0-9:
        # the online-edition notes, the dedication to FitzRoy, the
        # acknowledgements, and at chunk 9 the first chapter's contents line.
        # That line is not hypothetical — a smoke run quoted it as Bahia's diary
        # excerpt ("Fernando Noronha--Bahia--Burnished Rocks--Habits of a
        # Diodon…"), verbatim and therefore past the integrity gate, but it is
        # paratext rather than narrative. Chunk 1995 is the Gutenberg end
        # marker. retrieve_chunks() honours this range as well as the planner,
        # so both stop seeing them.
        #
        # KNOWN LIMITATION: this edition opens every chapter with a contents
        # line, so the same shape recurs inside the range at 150, 241, 414, 479,
        # 691 and beyond. A range cannot exclude those without cutting the
        # narrative around them. One excerpt in twenty-four was affected, so it
        # is a real but not epidemic risk; the durable fix is for the extractor
        # to recognise a contents line structurally and decline to quote it.
        "narrative_chunk_range": (10, 1994),
        "evidence_basis": "contemporary-journal",
        "what_was_lost": "Darwin's journal and FitzRoy's survey records survive "
                         "complete. What the voyage never recorded is the other half "
                         "of one of its own purposes: Jemmy Button, York Minster and "
                         "Fuegia Basket were taken to England, displayed, taught, and "
                         "carried home again, written about constantly and never asked "
                         "to write. Their account of what was done to them does not "
                         "exist.",
    },

    "xuanzang-629": {
        "title": "Xuanzang's Journey to the Western Regions (629-645)",
        "navigator": "Xuanzang",
        "ships": "on foot, by horse and by camel, across the Taklamakan and the Hindu Kush",
        "sponsor": "none — he left Tang China against an imperial ban on travel, "
                   "and returned sixteen years later to an emperor's welcome",
        "summary": "The great overland journey: out of Chang'an past the frontier "
                   "towers, along the northern Silk Road through Kucha and Kashgar, "
                   "over the Tian Shan to Samarkand, south through Balkh and Bamiyan "
                   "to Gandhara, then across northern India to Nalanda, where he "
                   "studied for years, on to the far south and Ceylon, and home again "
                   "by the southern desert route with six hundred and fifty-seven "
                   "Buddhist texts.",
        "date_window": (629, 645),
        # Calibrated against the corpus (2026-07-27). Beal 1884, both volumes in one Digital Library of India scan, 2,728 PD chunks. Front matter 0-6 and Beal's introduction run to about 75; the alphabetical index occupies the last hundred-odd chunks.
        # KNOWN LIMITATION: a scholarly edition whose OCR interleaves Beal's
        # footnote apparatus with the text throughout, so a quotation may pick
        # up an editorial note. Highest garbled-token density of the nine
        # corpora (0.23%) — see docs/LIBRARY_QUEUE.md on what verbatim can
        # promise for a scan.
        "narrative_chunk_range": (76, 2600),
        # First-hand, but not a log kept on the road. The Records were composed
        # after his return, at the emperor's request, by his disciple Bianji
        # writing down what Xuanzang told him — which is the testimony tier's
        # definition exactly, and the first time a non-European voyage exercises
        # it.
        "evidence_basis": "contemporary-testimony",
        "what_was_lost": "Whatever notes Xuanzang carried are gone. What survives "
                         "was set down after he came home, by a disciple taking his "
                         "dictation, and it is arranged as a geography of countries "
                         "rather than as a journey with dates — so the order of the "
                         "route is read from the order of the text, and almost none "
                         "of it can be dated to a day. He also left China illegally, "
                         "against an imperial ban, so no official record of his "
                         "departure was ever made.",
    },

    "shackleton-1914": {
        "title": "The Imperial Trans-Antarctic Expedition (1914-1917)",
        "navigator": "Ernest Shackleton",
        "ships": "Endurance, the boat James Caird, and Aurora in the Ross Sea",
        "sponsor": "sailing from Plymouth and South Georgia to cross the Antarctic continent",
        "summary": "A crossing that never began: Endurance beset in the Weddell Sea "
                   "and crushed, the drift on the floes through Ocean Camp and Patience "
                   "Camp, the boat journey to Elephant Island, Shackleton's eight "
                   "hundred miles to South Georgia in the James Caird, the crossing of "
                   "its unmapped interior to Stromness, and the rescue of every man "
                   "left behind.",
        "date_window": (1914, 1917),
        # Calibrated against the corpus (2026-07-27). Gutenberg #5199, 1,431 PD chunks. Front matter 0-7 is title, contents and plate list; the narrative opens at 8 with the preparations for a last great journey. 1428-1429 index, 1430 Gutenberg boilerplate.
        "narrative_chunk_range": (8, 1427),
        "evidence_basis": "contemporary-journal",
        "what_was_lost": "Shackleton, Worsley and Hurley all kept diaries, and "
                         "Worsley's navigational log survives — which is why the "
                         "positions here are exact for a voyage that spent most of "
                         "itself without a ship. What was lost was physical: Hurley "
                         "smashed more than three hundred of his own glass plates on "
                         "the ice, keeping only what could be carried. The Ross Sea "
                         "party, which lost three men laying depots for a crossing that "
                         "never came, is the half of this expedition almost nobody "
                         "recorded.",
    },

    # ---- third wave. Cabot is the first 'reconstructed' voyage the atlas
    # has ever held: the tier was written for exactly this and had never
    # been used in production. ----

    "gama-1497": {
        "title": 'Vasco da Gama and the Sea Road to India (1497-1499)',
        "navigator": 'Vasco da Gama',
        "ships": 'São Gabriel, São Rafael, Berrio and a storeship',
        "sponsor": 'sailing from Lisbon for King Manuel I of Portugal',
        "summary": 'The voyage that joined Europe to the Indian Ocean: a long arc into the open Atlantic to catch the westerlies, the Cape rounded ten years after Dias, up the Swahili coast past Mozambique and Mombasa to Malindi, and across to Calicut with a pilot who knew the monsoon.',
        "date_window": (1497, 1499),
        # Calibrated against the corpus (2026-07-27). Ravenstein 1898, 826 PD chunks. Ravenstein's introduction runs to 67; the Roteiro proper opens at 68. 824-825 is Gutenberg boilerplate.
        "narrative_chunk_range": (68, 823),
        "evidence_basis": 'contemporary-journal',
        "what_was_lost": "The Roteiro was kept during the voyage by someone aboard — and nobody knows who. It is signed by no one; Álvaro Velho is a guess. Da Gama's own report to the king is lost. Of roughly 170 men who sailed, some 55 came back, and the journal breaks off before the end.",
    },

    "drake-1577": {
        "title": "Drake's Circumnavigation (1577-1580)",
        "navigator": 'Francis Drake',
        "ships": 'Pelican, renamed Golden Hind',
        "sponsor": 'sailing from Plymouth under a commission from Elizabeth I kept deliberately vague',
        "summary": 'The second circumnavigation and the first by a captain who survived it: south to Port San Julián and the execution of Thomas Doughty, through the Strait, up the Pacific coast raiding Spanish shipping, a landing on the California coast he called Nova Albion, then west across the Pacific and home by the Cape.',
        "date_window": (1577, 1580),
        # Calibrated against the corpus (2026-07-27). Hakluyt 1854 via archive.org, 1,157 PD chunks. The Society's officer list, subscription terms and editorial preface run to about 29; the back index begins around 1151. Conservative at both ends: an OCR'd Hakluyt volume has no clean marker, and losing a few chunks costs less than quoting a subscription notice.
        "narrative_chunk_range": (30, 1150),
        "evidence_basis": 'contemporary-testimony',
        "what_was_lost": "Drake published nothing. This account was compiled in 1628 by his nephew from the notes of Francis Fletcher, the chaplain — whose original manuscript is lost, and who quarrelled with Drake on the voyage. The queen ordered the expedition's charts and journals surrendered and kept secret, so what survives is a family's version of a state secret, fifty years late.",
    },

    "polo-1271": {
        "title": 'The Travels of Marco Polo (1271-1295)',
        "navigator": 'Marco Polo',
        "ships": 'overland by caravan, and home by sea from Zaiton',
        "sponsor": 'travelling with his father and uncle, merchants of Venice',
        "summary": "Twenty-four years out of Venice: through Persia and the Pamirs to Kublai Khan's court at Khanbaliq, years in the Khan's service across Cathay and the south, then home by sea through the Indies, Ceylon and Hormuz.",
        "date_window": (1271, 1295),
        # Source swapped to Marsden 1892 (see sources.py). Range to be
        # calibrated after the re-ingestion — the Yule range is meaningless
        # against a different book.
        "evidence_basis": 'contemporary-testimony',
        "what_was_lost": 'Polo kept no journal. The book was dictated in a Genoese prison around 1298 to Rustichello of Pisa, a writer of Arthurian romances, more than two decades after the events. No original manuscript survives and the roughly 150 that do disagree with one another, some carrying episodes the others lack.',
    },

    "ibnbattuta-1325": {
        "title": 'The Rihla of Ibn Battuta (1325-1354)',
        "navigator": 'Ibn Battuta',
        "ships": 'by caravan, by dhow and on foot across three continents',
        "sponsor": 'setting out from Tangier on the hajj, and not stopping for twenty-nine years',
        "summary": 'Perhaps 120,000 kilometres: Mecca by way of Egypt and Syria, then Persia, the Swahili coast, Anatolia, the Golden Horde, India and eight years in the service of the Sultan of Delhi, the Maldives, Ceylon, China — and later, from Morocco, across the Sahara to Mali.',
        "date_window": (1325, 1354),
        # Calibrated against the corpus (2026-07-27). Lee 1829 via archive.org, 1,138 PD chunks. The Oriental Translation Fund's front matter is OCR'd so badly it is unreadable rather than merely wrong ('TBANtUlTW >nOM rilK AKKIDCKU ARABIC HANUSCRIFT'), which is itself the signal: the narrative is legible and the apparatus is not. Conservative at both ends.
        "narrative_chunk_range": (30, 1130),
        "evidence_basis": 'contemporary-testimony',
        "what_was_lost": "Ibn Battuta wrote nothing down as he travelled, and said so: his notes were lost at sea. On his return the Sultan of Morocco had him dictate everything to Ibn Juzayy, who shaped it and borrowed passages from earlier travel writers. This English text is Lee's 1829 abridgement of an abridged manuscript — the complete Rihla in English exists only in a translation still in copyright.",
    },

    "leoafricanus-1510": {
        "title": 'Leo Africanus in Africa (c. 1510-1520)',
        "navigator": 'al-Hasan ibn Muhammad al-Wazzan (Leo Africanus)',
        "ships": 'by caravan across the Atlas, the Sahara and the Niger',
        "sponsor": 'travelling as a diplomat for the Sultan of Fez',
        "summary": 'North and West Africa described from inside it: Fez and Morocco, the Atlas passes, the Saharan crossings, Timbuktu and Gao under Songhai, the Niger, and eastward to Egypt — the account that gave Europe most of what it thought it knew about the interior for three hundred years.',
        "date_window": (1510, 1520),
        # Calibrated against the corpus (2026-07-27). Pory 1600 / Brown 1896 via archive.org, 1,430 PD chunks. Google's scanning notice occupies 0-4, then the Hakluyt front matter and Brown's long introduction; Pory's translation is under way well before 288. The index runs from about 1421.
        "narrative_chunk_range": (60, 1420),
        "evidence_basis": 'contemporary-testimony',
        "what_was_lost": "He was captured by Spanish corsairs, presented to the Pope, baptised, and wrote in Italy for a European readership — from memory, years afterwards, as a man whose freedom depended on being useful. His Arabic original is lost. What survives passed through Ramusio's Italian and then Pory's English of 1600: two removes from a man already writing in his captors' language.",
    },

    "faxian-399": {
        "title": "Faxian's Journey to the Buddhist Kingdoms (399-414)",
        "navigator": 'Faxian',
        "ships": 'on foot across the Taklamakan, and home by sea from Ceylon',
        "sponsor": "setting out from Chang'an at about sixty, to find the monastic rules India still held",
        "summary": 'Overland through Dunhuang and the desert to Khotan, over the Pamirs to Gandhara and the Ganges plain, years at Pataliputra copying texts, then Ceylon, and home by merchant ship through Java — shipwrecked twice and landing far north of where he meant to.',
        "date_window": (399, 414),
        # Calibrated against the corpus (2026-07-27). Legge 1886, 500 PD chunks. Legge's preface and prolegomena run to 47; 'THE TRAVELS OF FA-HIEN' opens at 48. 498-499 is Gutenberg boilerplate.
        "narrative_chunk_range": (48, 497),
        "evidence_basis": 'contemporary-testimony',
        "what_was_lost": "Faxian wrote his record after returning, in his seventies, from memory and the texts he had carried. It is short — a few dozen pages for fifteen years — and Legge's Victorian transliterations make its places hard to resolve. He travelled with companions who turned back, died, or stayed in India; none of them left an account.",
    },

    "verrazzano-1524": {
        "title": 'Verrazzano and the Atlantic Coast (1524)',
        "navigator": 'Giovanni da Verrazzano',
        "ships": 'La Dauphine',
        "sponsor": 'sailing from Normandy for Francis I of France',
        "summary": 'The first recorded European survey of the North American coast between Florida and Newfoundland: a landfall near Cape Fear, the long run north, the narrows into what is now New York Bay, a fortnight in Narragansett Bay, and on past a coast whose people met him with less welcome the further he went.',
        "date_window": (1524, 1524),
        # Calibrated against the corpus (2026-07-27). Murphy 1875, 563 PD chunks. 556-562 is Gutenberg boilerplate.
        # KNOWN LIMITATION: this is not an edition of the letter but a book
        # arguing the letter is a forgery, and it quotes the letter inside its own
        # argument — the text at chunk 18 is Verrazzano's, the sentence before it
        # is Murphy's. A range cannot separate a quotation from its rebuttal, so
        # excerpts here may be the critic's words. Declared contested for exactly
        # this reason.
        "narrative_chunk_range": (10, 555),
        "evidence_basis": 'contemporary-testimony',
        "what_was_lost": 'The original letter to Francis I is lost; what survives are later copies, and the only public-domain English edition is a volume by Henry Cruse Murphy arguing at length that the letter is a forgery. Modern scholarship has largely moved back toward authenticity, but the atlas quotes it through the book that disputes it, and says so.',
    },

    "mungopark-1795": {
        "title": 'Mungo Park on the Niger (1795-1797)',
        "navigator": 'Mungo Park',
        "ships": 'on horseback and on foot, and finally with nothing at all',
        "sponsor": 'sent by the African Association of London to find the course of the Niger',
        "summary": 'Inland from the Gambia with two companions and a horse: imprisoned for four months by a Moorish chief, escaping alone across the Sahel, reaching the Niger at Segou to find it flowing east, and walking back destitute — carried the last stage by a slave caravan whose passage he recorded from inside it.',
        "date_window": (1795, 1797),
        # Calibrated against the corpus (2026-07-27). 1799 first edition via archive.org, 1,461 PD chunks. Dedication, subscriber list and contents run to 13; the narrative follows. The appendix and geographical notes occupy the last chunks.
        "narrative_chunk_range": (14, 1450),
        "evidence_basis": 'contemporary-journal',
        "what_was_lost": 'Park kept notes throughout and lost most of them; the narrative was written up in London afterwards, for a society that had paid for it. The people who kept him alive appear mostly without names. And the coffle he travelled with on the return is described by the one man in it who was not for sale.',
    },

    "lewisclark-1804": {
        "title": 'Lewis and Clark: the Corps of Discovery (1804-1806)',
        "navigator": 'Meriwether Lewis and William Clark',
        "ships": 'a keelboat, two pirogues, then dugout canoes and horses',
        "sponsor": 'sent by President Jefferson to find a water route across the continent',
        "summary": 'Up the Missouri from St Louis, a winter among the Mandan, over the Bitterroots with Shoshone horses and Nez Perce guidance, down the Snake and Columbia to the Pacific, a wet winter at Fort Clatsop, and back.',
        "date_window": (1804, 1806),
        # Calibrated against the corpus (2026-07-27). Gutenberg #8419, 5,683 PD chunks. The journals begin almost at once — chunk 2 is already the roster of the party. 5681-5682 is Gutenberg boilerplate.
        "narrative_chunk_range": (2, 5680),
        "evidence_basis": 'contemporary-journal',
        "what_was_lost": 'The journals are among the fullest of any expedition — and they are the record of the people who arrived. Sacagawea, without whom the party would not have crossed the mountains, is written about constantly and never quoted. The nations who fed, guided and tolerated them appear as the captains understood them, and the maps that resulted were used to dispossess those nations within two generations.',
    },

    "cabot-1497": {
        "title": "John Cabot's Atlantic Landfall (1497)",
        "navigator": 'John Cabot',
        "ships": 'the Matthew, of Bristol, with a crew of about eighteen',
        "sponsor": 'sailing from Bristol under letters patent from Henry VII',
        "summary": 'Thirty-five days west from Bristol to a landfall in North America, a single going-ashore to plant a flag and take on water, and a fast run home — the voyage that gave England its claim to the continent, and whose landfall nobody can locate.',
        "date_window": (1497, 1497),
        # Calibrated against the corpus (2026-07-27). Olson & Bourne 1906, Gutenberg #18571 — the SAME volume as columbus-1492, and the reason this range is exact rather than generous. Chunks up to 1416 are Columbus's voyages; 'THE VOYAGES OF JOHN CABOT — LETTER OF LORENZO PASQUALIGO' begins at 1417. A wider range would have Cabot quoting Columbus's log, which is the one confusion this voyage cannot afford: Cabot's whole entry rests on there being no account by him.
        "narrative_chunk_range": (1417, 1505),
        "evidence_basis": 'reconstructed',
        "what_was_lost": "Cabot left nothing. No log, no letter, no chart, and no account by anyone who sailed with him. Everything known comes from four documents by people who were not there: a merchant's letter from Lisbon, two despatches by the Duke of Milan's man in London, and a payment in the king's household book. Where he landed has been argued over for four centuries — Newfoundland, Cape Breton, Labrador, Maine — and this atlas draws a route it cannot prove, because the voyage happened and the silence is the archive's, not history's.",
    },

}


def _year_of(date_str):
    """The year from a date the pipeline produced, which may be '1834-04-13',
    '1832-08' or None. Comparing years rather than full dates is deliberate: the
    itinerary planner is confident about order and vague about days, so a
    day-level comparison would flag noise the desk cannot act on."""
    m = re.match(r"(\d{4})", str(date_str or ""))
    return int(m.group(1)) if m else None


def chronology_breaks(waypoints):
    """Stages dated before the stage they follow, as (where, why) pairs.

    A voyage runs forwards. Where it does not, something has gone wrong that no
    model can be trusted to notice, and this is where it goes wrong: a place
    visited twice takes whichever of its two dates the extractor met first.
    Darwin's Berkeley Sound came back dated 1833 sitting after an 1834 stage,
    because the Beagle called at the Falklands twice; the same run had Bahia in
    the outbound position carrying the 1836 return date.

    It flags and never repairs. Which of two real visits a stage refers to is an
    editorial question, and a script that silently picked one would be inventing
    the answer — which is the whole thing this project refuses to do.
    """
    out = []
    for prev, cur in zip(waypoints, waypoints[1:]):
        a, b = _year_of(prev.get("arrival_date")), _year_of(cur.get("arrival_date"))
        if a and b and b < a:
            out.append((
                f"wp{cur.get('seq')} '{cur.get('place_historical')}'",
                f"CHRONOLOGY: dated {b} but follows wp{prev.get('seq')} "
                f"'{prev.get('place_historical')}' dated {a}. A place reached twice "
                f"has probably taken the other visit's date — needs an editorial "
                f"decision, not a guess",
            ))
    return out


def _now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- text norm (verbatim check)
def norm(s):
    """Normalize text for verbatim matching: unicode quotes, whitespace, case.
    Mirrors scripts/curator.py's norm() exactly — same substring-match contract."""
    s = unicodedata.normalize("NFKC", s)
    s = (s.replace("‘", "'").replace("’", "'")
           .replace("“", '"').replace("”", '"')
           .replace("—", "-").replace("–", "-"))
    return re.sub(r"\s+", " ", s).strip().casefold()


_EN = re.compile(r"\b(the|and|of|to|was|were|which|that|with|from|they|we|had|there|this)\b", re.I)
# Short high-signal function words that are not also English words. "plus" and
# "son" are deliberately absent: both are ordinary English, and a false French
# reading discards a good quotation, which is the costlier mistake.
_FR = re.compile(r"\b(les|des|que|qui|nous|leur|ledit|ladicte|dudit|icelle|aultre|"
                 r"lesquelz|estoit|avons|sont|pour|dans|cette|nostre|vne|est|"
                 r"et|au|aux|avec|il|ils|elle|sur|par|tout|tous|ainsi|comme|"
                 r"fut|sans|ung|ses|nos|vers|ceulx|quinze|trois)\b", re.I)


def reads_as_english(text, margin=1.5):
    """Whether a quotation is in the language Terraveler publishes.

    Carta §4: "The language of Terraveler is English, always. Sources may be in
    any language; published content is in English."

    Some editions print the original facing the translation, and the corpus
    interleaves them: Biggar's Cartier is roughly 975 English chunks against 365
    French, alternating page by page. A chunk_index range cannot separate what
    alternates, so four of Cartier's twenty-three excerpts came back in
    sixteenth-century French — verbatim, correctly verified, and unpublishable.

    Deliberately a function-word count rather than a model. The distinction here
    is coarse and the stakes are a null: an English passage carrying French
    place names must not be discarded, so the margin is generous and a tie goes
    to keeping the quote. Where it guesses wrong the cost is a stage that says
    it has no excerpt, which the atlas already knows how to say honestly.
    """
    if not text:
        return True
    en, fr = len(_EN.findall(text)), len(_FR.findall(text))
    if en == 0 and fr == 0:
        return True                      # too short to judge; let it through
    return en >= fr / margin if fr else True


def fetchable_source_url(url):
    """The citation URL is for a human; verification needs the plain text.

    rag_docs.source_url is the readable landing page — gutenberg.org/ebooks/{id},
    archive.org/details/{id} — which is HTML. The verify node re-fetches this URL
    and substring-matches the quote against it, so a landing page means nothing
    ever verifies.

    That is not hypothetical. The Gutenberg case was mapped from the start; the
    archive.org case was not, and Pizarro came back with 0 of 17 excerpts
    confirmed and all of them nulled. The source-integrity gate did exactly what
    it should — it refused to keep a quote it could not re-find — but what it
    could not find was the text, not the quote. Every archive.org voyage would
    have produced an itinerary with nothing to say.
    """
    if not url:
        return url
    m = re.search(r"gutenberg\.org/ebooks/(\d+)", url)
    if m:
        i = m.group(1)
        return f"https://www.gutenberg.org/cache/epub/{i}/pg{i}.txt"
    m = re.search(r"archive\.org/(?:details|download)/([^/?#]+)", url)
    if m:
        return archive_text_url(m.group(1)) or url
    return url


_ARCHIVE_TXT_CACHE = {}


def archive_text_url(identifier):
    """The OCR text file inside an archive.org item, found through its metadata.

    The filename is per-item and unguessable — '2015.49333.Buddhist-Records-Of-
    The-Western-World--Vol-1-2_djvu.txt' — so it is looked up rather than
    constructed, and cached because verify calls this once per waypoint.
    """
    if identifier in _ARCHIVE_TXT_CACHE:
        return _ARCHIVE_TXT_CACHE[identifier]
    out = None
    try:
        req = urllib.request.Request(
            f"https://archive.org/metadata/{identifier}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            meta = json.loads(r.read().decode("utf-8", "replace"))
        for f in meta.get("files", []):
            if str(f.get("name", "")).endswith("_djvu.txt"):
                out = f"https://archive.org/download/{identifier}/{f['name']}"
                break
    except Exception:
        out = None          # verify will null the excerpt, which is the safe end
    _ARCHIVE_TXT_CACHE[identifier] = out
    return out


def haversine_km(a_lat, a_lng, b_lat, b_lng):
    R = 6371.0
    p = math.pi / 180
    s = (math.sin((b_lat - a_lat) * p / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(s))


# ------------------------------------------------------------- model calls
#
# Two providers, chosen by the model name. The pipeline was written against
# OpenAI and the account's quota ran out mid-batch — not a rate limit that would
# pass, but the balance — which stopped four voyages with a 429 that looked like
# throttling. A single provider is a single point of failure for a job that runs
# for hours, so the call is now provider-agnostic and the model name decides.
#
# Both are asked for JSON and both are retried with the same backoff. The
# difference is only in shape: OpenAI takes a system role in the message list
# and can be told response_format=json_object; Anthropic takes system as its own
# parameter and has to be asked for JSON in the prompt, so the caller's system
# text is given a JSON instruction here rather than in every call site.


def _post_json(url, headers, body, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        # The body says what is wrong; the status alone says only that
        # something is. A 400 debugged from the status is guesswork.
        detail = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"HTTP {e.code} from {url}: {detail}") from None


def _extract_json(text):
    """Anthropic returns prose around JSON often enough to matter. Take the
    outermost object rather than trusting the whole response to parse."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        i, j = text.find("{"), text.rfind("}")
        if i == -1 or j <= i:
            raise
        return json.loads(text[i:j + 1])


def _chat_json(model, system, user, temperature=0, timeout=180):
    anthropic = model.startswith("claude")
    if anthropic:
        if not ANTHROPIC_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        url = "https://api.anthropic.com/v1/messages"
        headers = {"Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY,
                   "anthropic-version": "2023-06-01"}
        # No temperature: the Claude 5 models reject it as deprecated, and the
        # 400 says so — which is only useful if the error body is read, which is
        # why _post_json surfaces it.
        body = {"model": model, "max_tokens": 8192,
                "system": system + "\n\nRespond with a single JSON object and nothing else.",
                "messages": [{"role": "user", "content": user}]}
    else:
        if not KEY:
            raise RuntimeError("OPENAI_API_KEY not set")
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"}
        body = {"model": model, "temperature": temperature,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}]}

    for attempt in range(4):
        try:
            data = _post_json(url, headers, body, timeout)
            content = (data["content"][0]["text"] if anthropic
                       else data["choices"][0]["message"]["content"])
            return _extract_json(content)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.6 ** attempt)


def _embed(text):
    body = json.dumps({"text": text}).encode()
    url = os.environ.get("EMBED_URL", "http://terraveler_embedding:8010").rstrip("/") \
        + "/v1/embeddings/create"
    req = urllib.request.Request(url, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode())
    if not resp.get("success"):
        raise RuntimeError(resp.get("error") or "embed failed")
    return resp["embedding"]


def _emb_literal(vec):
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


# ---------------------------------------------------------------- side-channel
class Corpus:
    def __init__(self):
        self.chunks = []          # ordered PD journal chunks for the voyage (planning sample source)
        self.waypoints = []       # plan_itinerary -> extract -> geocode -> verify
        self.submission = None
        self._fetch_cache = {}    # url -> live re-fetched full text (verify)

    def fetch_live(self, url):
        if url not in self._fetch_cache:
            self._fetch_cache[url] = F.fetch_gutenberg(url)
        return self._fetch_cache[url]


# ---------------------------------------------------------------- db
def pg_connect(ctx):
    return psycopg2.connect(host=ctx.pg_host, port=ctx.pg_port, dbname=ctx.pg_db,
                             user=ctx.pg_user, password=ctx.pg_pass)


# ================================================================== NODE 1: plan_itinerary
PLAN_SYSTEM = """You are a maritime historian producing the canonical, ORDERED \
itinerary — the complete list of major stops, in chronological order — for a \
specific historical voyage. Which places a well-documented voyage like this \
visited, and in what order, is settled historical fact; you are not \
inventing anything, you are enumerating it correctly and completely. (The \
actual diary quotes proving each stop will be grounded separately, later, \
against the real source text — you are not being asked for quotes here, \
only for the itinerary skeleton.)

You are given the voyage's title/summary, and a SAMPLE of chunks scattered \
across the ENTIRE chunk_index span of the primary journal source in the \
corpus (not just its densest, most-quoted middle section) — use it as \
supporting context and a sanity check, but rely primarily on your own \
historical knowledge of this voyage for completeness and ordering, since a \
sparse sample can easily under-represent a real leg that the ship still \
visited.

REQUIREMENTS — all mandatory:
1. The FIRST stop MUST be the voyage's departure port (where it set sail from).
2. The LAST stop MUST be the return/home leg (where and how the voyage ended).
3. Include EVERY major landfall or leg in between, in chronological order. \
Do NOT skip a leg just because the sample shows it only briefly or not at \
all — if you know historically the ship went there, include it. Do NOT \
merge two historically distinct legs into one stop just to shorten the list.
4. 10-24 stops is typical for a multi-year global voyage; let the true \
number of distinct legs decide the count, don't force a round number.
5. For each stop, give your best-effort approximate arrival date (partial is \
fine, e.g. "1770-04" or "1770-04-29"); null if genuinely unknown.

Return STRICT JSON: {"stops": [{"place": "<place name, plain English, with \
enough context to disambiguate e.g. 'Botany Bay, New Holland (Australia)'>", \
"approx_date": "<YYYY-MM[-DD] or null>", "what_happened": "<<=200 char \
summary of what happened at/around this stop>"}, ...]} in final \
chronological order, departure first, return/home last."""


def _plan_sample(corpus_chunks, target):
    """Scatter a representative sample across the WHOLE narrative range so the
    planner sees the full span (including sparsely-documented legs), rather
    than whatever happens to be densest. Always anchors the first and last
    narrative chunks (departure / return context)."""
    n = len(corpus_chunks)
    if n == 0:
        return []
    step = max(1, n // target)
    sample = corpus_chunks[::step][:target]
    for edge in (corpus_chunks[0], corpus_chunks[-1]):
        if edge not in sample:
            sample.append(edge)
    sample.sort(key=lambda c: c["chunk_index"])
    return sample


def plan_itinerary_node(ctx, corpus):
    def node(state):
        meta = VOYAGE_META[ctx.voyage]
        lo, hi = meta.get("narrative_chunk_range", (0, 10**9))
        conn = pg_connect(ctx)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT DISTINCT title, source_url
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                """, (ctx.voyage,))
                sources = cur.fetchall()
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                """, (ctx.voyage, lo, hi))
                corpus.chunks = cur.fetchall()
        finally:
            conn.close()

        state = state.with_decision(Decision(
            f"Plan itinerary: primary-journal narrative chunk_index range "
            f"[{lo},{hi}] (excludes front matter / table of contents / "
            f"back-of-book index) across {len(sources)} public-domain source(s)", _now()))

        if ctx.chunk_limit:
            corpus.chunks = corpus.chunks[:ctx.chunk_limit]

        n = len(corpus.chunks)
        state = state.with_fact(Fact("pd_narrative_chunks", n, "plan_itinerary", _now()))
        if n == 0:
            return state.with_rejection(Rejection(
                "plan_itinerary",
                f"no public-domain narrative chunks found for {ctx.voyage} in "
                f"range [{lo},{hi}]", _now()))

        sample = _plan_sample(corpus.chunks, ctx.plan_sample_size)
        listing = "\n\n".join(
            f"[chunk_index={c['chunk_index']}]\n{c['content'][:500]}" for c in sample)
        source_listing = "\n".join(f"- {s['title']} ({s['source_url']})" for s in sources)

        user = (
            f"VOYAGE: {meta['title']}\n"
            f"SUMMARY: {meta['summary']}\n\n"
            f"PRIMARY-JOURNAL SOURCE(S) IN THE CORPUS:\n{source_listing}\n\n"
            f"SAMPLE CHUNKS scattered across the full narrative span "
            f"(chunk_index {lo}-{hi}, {n} total chunks in range, "
            f"{len(sample)} sampled here):\n\n{listing}"
        )

        try:
            data = _chat_json(PLAN_MODEL, PLAN_SYSTEM, user)
            stops = data.get("stops", [])
        except Exception as e:
            # A failed plan is not an empty voyage. Returning here produced a
            # submission with zero waypoints that looked like a completed run —
            # a rate limit took three voyages that way in one batch, and the
            # only sign was a suspiciously round number.
            raise RuntimeError(
                f"planning call failed for {ctx.voyage}: {str(e)[:160]}. "
                f"No draft written — a voyage with no itinerary is a failed run, "
                f"not a short one.") from e

        waypoints = []
        for i, s in enumerate(stops):
            place = (s.get("place") or "").strip()
            if not place:
                continue
            waypoints.append({
                "seq": i + 1,
                "place_historical_raw": place,
                "canonical_what_happened": s.get("what_happened") or "",
                # full narrative range -> the per-stop retrieve step below does an
                # UNBIASED semantic kNN search over the whole journal for this
                # place, rather than assuming a chunk-position prior we don't have.
                "chunk_lo": lo, "chunk_hi": hi,
                "candidate_dates": [s["approx_date"]] if s.get("approx_date") else [],
            })
        corpus.waypoints = waypoints

        state = state.with_fact(Fact("plan_sample_chunks", len(sample), "plan_itinerary", _now()))
        state = state.with_fact(Fact("plan_stops", len(waypoints), "plan_itinerary", _now()))

        # audit-only sanity check on the two mandatory endpoints (non-fatal —
        # exploration policy keeps going either way, but this is visible in
        # the trace for human review).
        if waypoints:
            first_l, last_l = waypoints[0]["place_historical_raw"].lower(), \
                waypoints[-1]["place_historical_raw"].lower()
            if "plymouth" not in first_l:
                state = state.with_rejection(Rejection(
                    "plan_itinerary endpoint check",
                    f"first stop '{waypoints[0]['place_historical_raw']}' does not "
                    f"mention Plymouth — verify the departure port is correct", _now()))
            if not any(k in last_l for k in ("england", "downs", "london", "home")):
                state = state.with_rejection(Rejection(
                    "plan_itinerary endpoint check",
                    f"last stop '{waypoints[-1]['place_historical_raw']}' does not "
                    f"obviously read as the return/home leg — verify", _now()))
            return state.with_decision(Decision(
                f"Plan itinerary ({PLAN_MODEL}): sampled {len(sample)}/{n} chunks "
                f"across narrative range [{lo},{hi}] -> {len(waypoints)} canonical "
                f"ordered stops (departure: '{waypoints[0]['place_historical_raw']}', "
                f"return: '{waypoints[-1]['place_historical_raw']}')", _now()))
        return state.with_rejection(Rejection(
            "plan_itinerary", "planning call returned zero usable stops", _now()))
    node.__name__ = "plan_itinerary"
    return node


# ================================================================== NODE 2: extract
EXTRACT_SYSTEM = """You are grounding ONE waypoint of a historical voyage or \
expedition using ONLY the primary-source excerpts shown below (a journal, \
memoir, or chronicle, all public domain). Do not use outside knowledge for \
facts not supported by the shown text, except for well-known geography \
needed to name the place.

Produce:
- place_historical: the place name as the 18th-century journal calls it.
- place_modern: the modern name, with country/region for disambiguation.
- geocode_name: a geocoding-ready name string INCLUDING country/region, e.g. \
"Botany Bay, New South Wales, Australia" — this is critical, a bare place \
name is not enough.
- approx_lat, approx_lng: your best-guess coordinate (decimal degrees) for \
place_modern, used only to sanity-check a gazetteer lookup — do not spend \
long deliberating, a reasonable estimate is fine.
- arrival_date: best date you can support from the text or context, ISO \
format, partial is fine ("1769-04" or "1769-04-13"); null if unknown.
- event: 1-2 sentences of prose describing what happened here, grounded in \
the shown excerpts.
- diary_excerpt: a VERBATIM, CONTIGUOUS span (1-3 sentences, copied \
EXACTLY, same spelling/punctuation) from ONE of the shown chunks that \
supports the event — or null if no good verbatim span exists. NEVER \
paraphrase and call it an excerpt. NEVER invent a quote. The span MUST be \
actual narrative prose (a full sentence or sentences describing what \
happened, with a subject and a verb) — NEVER a chapter/section heading, a \
table-of-contents-style line, or a fragment containing a bare page number \
(e.g. reject anything shaped like "CHAP. II. The Passage from Madeira to \
Rio de Janeiro, with some Account of ... 18"). If the only text mentioning \
this place is a heading, set diary_excerpt to null rather than use it.
- excerpt_chunk_index: the chunk_index (integer, shown in brackets before \
each excerpt) the diary_excerpt was copied from — null if diary_excerpt is \
null.

Return STRICT JSON with exactly these keys: place_historical, place_modern, \
geocode_name, approx_lat, approx_lng, arrival_date, event, diary_excerpt, \
excerpt_chunk_index."""


def retrieve_chunks(ctx, corpus, waypoint, k=8, pad=60):
    ctx_hint = waypoint.get("canonical_what_happened") or ""
    query_text = (f"{waypoint['place_historical_raw']} — historical voyage "
                  f"primary-source narrative. {ctx_hint}").strip()
    try:
        vec = _embed(query_text)
    except Exception:
        vec = None

    nlo, nhi = VOYAGE_META[ctx.voyage].get("narrative_chunk_range", (0, 10**9))
    conn = pg_connect(ctx)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            lo = max(nlo, waypoint["chunk_lo"] - pad)
            hi = min(nhi, waypoint["chunk_hi"] + pad)
            if vec is not None:
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """, (_emb_literal(vec), ctx.voyage, lo, hi, _emb_literal(vec), k))
            else:
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license, NULL AS similarity
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                    LIMIT %s
                """, (ctx.voyage, lo, hi, k))
            rows = cur.fetchall()
            if not rows:
                # fall back to plain chunk_index window, no semantic filter
                cur.execute("""
                    SELECT chunk_index, content, source_url, title, license
                    FROM rag_docs
                    WHERE voyage_slug = %s AND type = 'text' AND license ILIKE 'public domain'
                      AND chunk_index BETWEEN %s AND %s
                    ORDER BY chunk_index
                    LIMIT %s
                """, (ctx.voyage, waypoint["chunk_lo"], waypoint["chunk_hi"], k))
                rows = cur.fetchall()
            return rows
    finally:
        conn.close()


def extract_node(ctx, corpus):
    def node(state):
        n_with_excerpt = 0
        failed_calls = []
        for w in corpus.waypoints:
            chunks = retrieve_chunks(ctx, corpus, w)
            w["_retrieved"] = chunks
            if not chunks:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    "no PD chunks retrieved near its chunk range", _now()))
                continue
            listing = "\n\n".join(
                f"[chunk_index={c['chunk_index']}]\n{c['content']}" for c in chunks)
            try:
                data = _chat_json(EXTRACT_MODEL, EXTRACT_SYSTEM,
                                   f"WAYPOINT HINT: {w['place_historical_raw']} "
                                   f"(candidate dates: {w['candidate_dates']})\n\n"
                                   f"JOURNAL EXCERPTS:\n\n{listing}")
            except Exception as e:
                failed_calls.append(w["seq"])
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w['place_historical_raw']}'",
                    f"extract call failed: {str(e)[:120]}", _now()))
                continue

            w["place_historical"] = data.get("place_historical") or w["place_historical_raw"]
            w["place_modern"] = data.get("place_modern")
            w["geocode_name"] = data.get("geocode_name") or w["place_modern"] or w["place_historical"]
            w["approx_lat"] = data.get("approx_lat")
            w["approx_lng"] = data.get("approx_lng")
            w["arrival_date"] = data.get("arrival_date")
            w["event"] = data.get("event")
            w["diary_excerpt"] = data.get("diary_excerpt")
            eci = data.get("excerpt_chunk_index")
            src = None
            if w["diary_excerpt"] and eci is not None:
                src = next((c for c in chunks if c["chunk_index"] == eci), None)
            if src is None:
                w["diary_excerpt"] = None
                w["evidence_source"] = chunks[0]  # still ground the event in a real chunk
            else:
                w["evidence_source"] = src
                n_with_excerpt += 1

        state = state.with_fact(Fact("waypoints_with_candidate_excerpt", n_with_excerpt, "extract", _now()))
        # A run that lost most of its stages to a transport failure is a failed
        # run, not a short voyage. Verrazzano came back with 2 waypoints of ~20
        # after a 429, and a 2-stage draft passes the Stage-0 gate and reaches
        # the desk looking deliberate.
        if failed_calls and len(failed_calls) > max(2, len(corpus.waypoints) // 5):
            raise RuntimeError(
                f"{len(failed_calls)} of {len(corpus.waypoints)} extract calls failed "
                f"for {ctx.voyage} (seqs {failed_calls[:8]}...). No draft written: a "
                f"truncated itinerary is indistinguishable from a complete one once "
                f"it reaches the desk.")

        return state.with_decision(Decision(
            f"Extract ({EXTRACT_MODEL}): grounded {len(corpus.waypoints)} waypoints, "
            f"{n_with_excerpt} with a candidate verbatim excerpt (pre-verification)", _now()))
    node.__name__ = "extract"
    return node


# ================================================================== NODE 3: geocode
MISMATCH_KM = 600


def geocode_node(ctx, corpus):
    def node(state):
        for w in corpus.waypoints:
            approx = (w.get("approx_lat"), w.get("approx_lng"))
            has_approx = isinstance(approx[0], (int, float)) and isinstance(approx[1], (int, float))

            g = None
            try:
                g = oculus.geocode(w.get("geocode_name"))
            except Exception:
                g = None

            provenance = None
            retried = False
            if g and has_approx:
                dist = haversine_km(g["lat"], g["lng"], approx[0], approx[1])
                if dist > MISMATCH_KM:
                    retried = True
                    g2 = None
                    try:
                        g2 = oculus.geocode(w.get("place_historical") or w["place_historical_raw"])
                    except Exception:
                        g2 = None
                    if g2:
                        dist2 = haversine_km(g2["lat"], g2["lng"], approx[0], approx[1])
                        if dist2 <= MISMATCH_KM:
                            g = g2
                            dist = dist2
                        else:
                            g = None  # both gazetteer hits disagree with the model -> distrust gazetteer
                    else:
                        g = None
                    if g is None:
                        state = state.with_rejection(Rejection(
                            f"wp{w['seq']} geocode '{w.get('geocode_name')}'",
                            f"gazetteer mismatch >{MISMATCH_KM}km from model estimate "
                            f"({dist:.0f}km) even after retry — falling back to model coord", _now()))

            if g:
                w["latitude"], w["longitude"] = g["lat"], g["lng"]
                provenance = f"gazetteer:{g['gazetteer']}:{g.get('provenance')}"
                w["confidence"] = "approximate" if retried else "certain"
                # Keep the identity, not just the position. g["provenance"] is
                # "wikidata:Q42000" — the fact that this landfall IS Tahiti, which
                # was being resolved and then thrown away on every run. It is what
                # lets the atlas notice that Cook's King George's Island and
                # Bougainville's Taïti are one island. Retried hits are recorded
                # too but marked, since the first name failed to anchor.
                if str(g.get("provenance", "")).startswith("wikidata:"):
                    w["wikidata_qid"] = g["provenance"].split(":", 1)[1]
                    w["identity_confidence"] = "approximate" if retried else "certain"
            elif has_approx:
                w["latitude"], w["longitude"] = approx[0], approx[1]
                provenance = "model-estimate (gazetteer unanchored/mismatched)"
                w["confidence"] = "reconstructed"
            else:
                w["latitude"], w["longitude"] = None, None
                provenance = "none"
                w["confidence"] = "reconstructed"
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} geocode", "no gazetteer hit and no model approx coord", _now()))
            w["coord_provenance"] = provenance

        n_certain = sum(1 for w in corpus.waypoints if w["confidence"] == "certain")
        n_approx = sum(1 for w in corpus.waypoints if w["confidence"] == "approximate")
        n_recon = sum(1 for w in corpus.waypoints if w["confidence"] == "reconstructed")
        state = state.with_fact(Fact("confidence_certain", n_certain, "geocode", _now()))
        state = state.with_fact(Fact("confidence_approximate", n_approx, "geocode", _now()))
        state = state.with_fact(Fact("confidence_reconstructed", n_recon, "geocode", _now()))
        return state.with_decision(Decision(
            f"Geocode: {n_certain} certain, {n_approx} approximate, {n_recon} reconstructed", _now()))
    node.__name__ = "geocode"
    return node


# ================================================================== NODE 4: verify
def verify_node(ctx, corpus):
    def node(state):
        passed, dropped = 0, 0
        for w in corpus.waypoints:
            if not w.get("diary_excerpt"):
                continue
            src = w.get("evidence_source")
            url = fetchable_source_url(src["source_url"]) if src else None
            if not url:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify", "no source_url on evidence chunk", _now()))
                continue
            try:
                live = corpus.fetch_live(url)
            except Exception as e:
                w["diary_excerpt"] = None
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    f"source unreachable ({url}): {str(e)[:100]}", _now()))
                continue
            if norm(w["diary_excerpt"]) in norm(live):
                # Verbatim is necessary and not sufficient. A quotation can be
                # perfectly authentic and still unpublishable: Carta §4 says the
                # published language is English, always, and an edition that
                # prints the original facing the translation hands back both.
                if not reads_as_english(w["diary_excerpt"]):
                    dropped += 1
                    state = state.with_rejection(Rejection(
                        f"wp{w['seq']} verify '{w['place_historical']}'",
                        "excerpt verified verbatim but is not in English — nulled "
                        "per Carta 4 (sources may be in any language; published "
                        "content is in English)", _now()))
                    w["diary_excerpt"] = None
                    continue
                passed += 1
                state = state.with_decision(Decision(
                    f"wp{w['seq']} '{w['place_historical']}': diary_excerpt VERIFIED "
                    f"VERBATIM against live source", _now()))
            else:
                dropped += 1
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} verify '{w['place_historical']}'",
                    "excerpt NOT found verbatim in re-fetched live source — "
                    "nulled per source-integrity rule (never fabricated)", _now()))
                w["diary_excerpt"] = None

        state = state.with_fact(Fact("excerpts_verified", passed, "verify", _now()))
        state = state.with_fact(Fact("excerpts_dropped", dropped, "verify", _now()))
        return state.with_decision(Decision(
            f"Verify: {passed} excerpts VERBATIM-confirmed against live source, "
            f"{dropped} nulled (source-integrity gate)", _now()))
    node.__name__ = "verify"
    return node


# ================================================================== NODE 5: assemble
def assemble_node(ctx, corpus):
    def node(state):
        meta = VOYAGE_META[ctx.voyage]
        waypoints_out = []
        for w in corpus.waypoints:
            if w.get("latitude") is None:
                continue  # unanchored — drop from submission, kept only in trace/rejections
            # Undated stages get the same treatment as unanchored ones, and for
            # the same reason. This is a chrono-diary: the timeline is how a
            # reader moves through a voyage, and a stage that cannot be placed
            # in time cannot be scrubbed to. The Stage-0 gate refuses them —
            # Magellan came back with two — so emitting them only produces a
            # submission that will be rejected wholesale for the sake of a
            # stage the reader could never have reached.
            #
            # Dropped, not dated. Pigafetta does not date every landfall, and
            # interpolating one from the stages either side would be inventing
            # the single thing the reader most relies on.
            if not w.get("arrival_date"):
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w.get('place_historical') or w['place_historical_raw']}'",
                    "no arrival date in the source — dropped from the submission "
                    "(a chrono-diary cannot place an undated stage on the timeline)",
                    _now()))
                continue
            src = w.get("evidence_source") or {}
            evidence = {
                "quote": w.get("diary_excerpt"),
                "excerpt": w.get("diary_excerpt"),
                "source_url": fetchable_source_url(src.get("source_url")),
                "source_title": src.get("title"),
                "license": src.get("license"),
            }
            claim_confidence = w["confidence"] if w.get("diary_excerpt") else (
                "reconstructed" if w["confidence"] == "certain" else w["confidence"])
            # A claim whose quote the verify node could not confirm has a source
            # and nothing to stand on it — and the Stage-0 gate refuses it,
            # rightly, as "evidence incomplete". Darwin's departure from
            # Devonport is the case: the itinerary is certain, no verbatim
            # passage describes it, and emitting a sourced claim with an empty
            # excerpt asserts more than we can show.
            #
            # So the stage keeps its place in the route and simply carries no
            # claim. That is the same thing the log page already says out loud —
            # "no verified journal excerpt for this stage yet" — and it is a gap
            # a reader can close, rather than a claim nobody can check.
            claims = [{
                "text": w.get("event") or "",
                "confidence": claim_confidence,
                "evidence": evidence,
            }] if evidence["excerpt"] and evidence["source_url"] else []
            if not claims:
                state = state.with_rejection(Rejection(
                    f"wp{w['seq']} '{w.get('place_historical') or w['place_historical_raw']}'",
                    "no verbatim excerpt confirmed — stage kept, claim omitted "
                    "(Carta 3.4: verbatim or absent)", _now()))
            waypoints_out.append({
                "seq": w["seq"],
                "place_historical": w.get("place_historical") or w["place_historical_raw"],
                "place_modern": w.get("place_modern"),
                "latitude": w["latitude"],
                "longitude": w["longitude"],
                "arrival_date": w.get("arrival_date"),
                "confidence": w["confidence"],
                "coord_provenance": w.get("coord_provenance"),
                "claims": claims,
            })
        for i, w in enumerate(waypoints_out):
            w["seq"] = i + 1

        # A voyage runs forwards. Where a stage is dated before the one before
        # it, something has gone wrong that no model can be trusted to notice —
        # and this is where it goes wrong: a place visited twice gets whichever
        # of its two dates the extractor found first. Darwin's Berkeley Sound
        # came back dated 1833 sitting after an 1834 stage, because the Beagle
        # called at the Falklands twice; the same run had Bahia in the outbound
        # position carrying the 1836 return date.
        #
        # Deterministic and free, so it runs on every voyage rather than on the
        # ones anyone thought to check. It flags rather than repairs: which of
        # two real visits a stage refers to is an editorial question, and a
        # script that silently picked one would be inventing an answer.
        for where, why in chronology_breaks(waypoints_out):
            state = state.with_rejection(Rejection(where, why, _now()))

        submission = {
            "meta": {
                "type": "new-voyage",
                "target_voyage": ctx.voyage,
                "ideator": "terraveler-implementer",
                "contributor_rank": "cabin-boy",
                "scribe_model": EXTRACT_MODEL,
                "carta_version": CARTA_VERSION,
            },
            "voyage": {
                "slug": ctx.voyage,
                "title": meta["title"],
                "navigator": meta["navigator"],
                "ships": meta["ships"],
                "sponsor": meta["sponsor"],
                "summary": meta["summary"],
                "evidence_basis": meta["evidence_basis"],
                "what_was_lost": meta["what_was_lost"],
            },
            "waypoints": waypoints_out,
        }
        corpus.submission = submission

        os.makedirs(ctx.out_dir, exist_ok=True)
        out_path = os.path.join(ctx.out_dir, f"{ctx.voyage}.submission.json")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(submission, fh, indent=2, ensure_ascii=False)

        state = state.with_fact(Fact("final_waypoints", len(waypoints_out), "assemble", _now()))
        return state.with_decision(Decision(
            f"Assembled DRAFT submission with {len(waypoints_out)} waypoints -> {out_path}", _now()))
    node.__name__ = "assemble"
    return node


# ================================================================== wiring
def build_nodes(ctx, corpus):
    return [
        plan_itinerary_node(ctx, corpus),
        extract_node(ctx, corpus),
        geocode_node(ctx, corpus),
        verify_node(ctx, corpus),
        assemble_node(ctx, corpus),
    ]


def env(k, default=None):
    return os.environ.get(k, default)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voyage", required=True, choices=list(VOYAGE_META.keys()))
    ap.add_argument("--policy", choices=["strict", "exploration"], default="exploration")
    ap.add_argument("--plan-sample-size", type=int, default=60,
                     help="number of chunks scattered across the full narrative "
                          "range shown to the itinerary planner")
    ap.add_argument("--out-dir", default="/app/out")
    ap.add_argument("--chunk-limit", type=int, default=0,
                     help="cap PD chunks fed to the planner sample (0 = all) — for smoke tests")
    args = ap.parse_args()

    # Fail before the graph runs, not after: an unclassified voyage would
    # otherwise reach the desk claiming a journal it may not have.
    _m = VOYAGE_META[args.voyage]
    if _m.get("evidence_basis") not in EVIDENCE_BASES:
        sys.exit(f"{args.voyage}: VOYAGE_META needs an 'evidence_basis' from "
                 f"{list(EVIDENCE_BASES)}, got {_m.get('evidence_basis')!r}")
    if not (_m.get("what_was_lost") or "").strip():
        sys.exit(f"{args.voyage}: VOYAGE_META needs 'what_was_lost' — one sentence "
                 f"naming what is missing from the record and how it went. If "
                 f"genuinely nothing is missing, say that in a sentence.")

    ctx = argparse.Namespace(
        voyage=args.voyage,
        plan_sample_size=args.plan_sample_size,
        out_dir=args.out_dir,
        chunk_limit=args.chunk_limit,
        pg_host=env("PGHOST", "terraveler_postgres"),
        pg_port=int(env("PGPORT", "5432")),
        pg_db=env("PGDATABASE", "terraveler"),
        pg_user=env("PGUSER", "terraveler"),
        pg_pass=env("PGPASSWORD", ""),
    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    trace_id = f"extract-{args.voyage}-{stamp}"
    started = datetime.now(timezone.utc)

    corpus = Corpus()
    nodes = build_nodes(ctx, corpus)
    policy = Policy.STRICT if args.policy == "strict" else Policy.EXPLORATION

    state = GraphState.empty(trace_id).with_intent(f"extract:{args.voyage}")
    runner = Runner(nodes, policy=policy)

    print(f"▶ Axis extract  voyage={args.voyage}  policy={args.policy}", file=sys.stderr)
    final = runner.run(state)
    finished = datetime.now(timezone.utc)

    facts = {f.key: f.value for f in final.facts}
    summary = {
        "trace_id": trace_id,
        "voyage": args.voyage,
        "policy": args.policy,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "facts": facts,
        "decisions": [d.description for d in final.decisions],
        "rejections": [{"what": r.description, "why": r.reason} for r in final.rejections],
        "events": len(final.events),
    }

    os.makedirs(ctx.out_dir, exist_ok=True)
    trace_path = os.path.join(ctx.out_dir, f"{trace_id}.trace.json")
    with open(trace_path, "w", encoding="utf-8") as fh:
        json.dump({**summary, "trace": final.to_dict()}, fh, indent=2, ensure_ascii=False)

    try:
        conn = pg_connect(ctx)
        with conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ingestion_runs
                  (trace_id, voyage_slug, policy, started_at, finished_at,
                   facts, chunks_embedded, chunks_rejected, trace)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (trace_id, args.voyage, args.policy, started, finished,
                  int(facts.get("plan_stops", 0)),
                  int(facts.get("final_waypoints", 0)),
                  len(final.rejections), json.dumps(final.to_dict())))
        conn.close()
    except Exception as e:
        print(f"⚠ could not persist audit row to ingestion_runs: {e}", file=sys.stderr)

    print("─" * 60)
    print(json.dumps(summary, indent=2))
    print("─" * 60)
    print(f"✔ trace: {trace_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
