"""Per-voyage source registry. Only public-domain / CC sources.

Copyrighted secondary sites (e.g. herodote.net) are deliberately excluded —
we link to them, never ingest them.
"""

VOYAGE_SOURCES = {
    "boudeuse-1766": {
        "texts": [
            {"kind": "gutenberg",
             "title": "Bougainville — A Voyage Round the World (trans. Forster, 1772)",
             "url": "https://www.gutenberg.org/cache/epub/73429/pg73429.txt",
             "source_url": "https://www.gutenberg.org/ebooks/73429",
             "license": "Public domain"},
            {"kind": "gutenberg",
             "title": "Diderot — Supplément au Voyage de Bougainville",
             "url": "https://www.gutenberg.org/cache/epub/6501/pg6501.txt",
             "source_url": "https://www.gutenberg.org/ebooks/6501",
             "license": "Public domain"},
            {"kind": "gutenberg",
             "title": "Bougainville — Voyage autour du monde (French, 1771)",
             "url": "https://www.gutenberg.org/cache/epub/28485/pg28485.txt",
             "source_url": "https://www.gutenberg.org/ebooks/28485",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Louis Antoine de Bougainville", "Tahiti", "Ahutoru",
                        "Jeanne Barret", "Philibert Commerson", "Noble savage",
                        "Bougainvillea"]},
        ],
        "image_queries": [
            "Louis-Antoine de Bougainville portrait",
            "Tahiti 18th century engraving",
            "Bougainvillea botanical illustration",
            "La Boudeuse ship 18th century",
            "Ahutoru Tahitian",
            "Jeanne Barret circumnavigation",
        ],
    },

    # Cook — CURATED primary source: the COMPLETE first-voyage journal (Wharton
    # edition, Gutenberg #8106), which covers Plymouth → Australia → Batavia →
    # home. Fixes the auto-discovery gap where only Vol. I (ends at New Zealand)
    # was harvested. Curated beats auto-discovery for flagship voyages.
    "cook-1768": {
        "texts": [
            {"kind": "gutenberg",
             "title": "Captain Cook's Journal During His First Voyage Round the World (Wharton ed.)",
             "url": "https://www.gutenberg.org/cache/epub/8106/pg8106.txt",
             "source_url": "https://www.gutenberg.org/ebooks/8106",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["First voyage of James Cook", "James Cook", "HMS Endeavour",
                        "Transit of Venus, 1769", "Botany Bay"]},
        ],
        "image_queries": [
            "James Cook portrait",
            "HMS Endeavour ship",
            "Cook landing Botany Bay",
            "Endeavour River Cook",
            "Transit of Venus 1769 Tahiti",
        ],
    },

    # Cortés — CURATED. The eyewitness "journal" of the conquest: Bernal Díaz
    # del Castillo's Memoirs, BOTH volumes (Vol I: arrival→Tenochtitlan→Moctezuma;
    # Vol II: Noche Triste→siege→fall). Using both avoids the Cook single-volume
    # trap. First land-campaign voyage; the canonical-itinerary pass handles the
    # route (Veracruz → Cempoala → Tlaxcala → Cholula → Tenochtitlan → …).
    "cortes-1519": {
        "texts": [
            {"kind": "gutenberg",
             "title": "The Memoirs of the Conquistador Bernal Díaz del Castillo, Vol. I",
             "url": "https://www.gutenberg.org/cache/epub/32474/pg32474.txt",
             "source_url": "https://www.gutenberg.org/ebooks/32474",
             "license": "Public domain"},
            {"kind": "gutenberg",
             "title": "The Memoirs of the Conquistador Bernal Díaz del Castillo, Vol. II",
             "url": "https://www.gutenberg.org/cache/epub/32475/pg32475.txt",
             "source_url": "https://www.gutenberg.org/ebooks/32475",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Hernán Cortés", "Spanish conquest of the Aztec Empire",
                        "Fall of Tenochtitlan", "Moctezuma II", "La Noche Triste",
                        "Tenochtitlan", "La Malinche"]},
        ],
        "image_queries": [
            "Hernán Cortés portrait",
            "Tenochtitlan city",
            "Moctezuma II",
            "La Malinche Malintzin",
            "Fall of Tenochtitlan siege",
        ],
    },

    # La Pérouse — corpus stub. PD sources to be confirmed before a real run.
    "laperouse-1785": {
        "texts": [
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Jean-François de Galaup, comte de Lapérouse",
                        "Lapérouse expedition", "Astrolabe (1781)", "Boussole"]},
        ],
        "image_queries": [
            "Jean-Francois de La Perouse portrait",
            "Laperouse expedition Astrolabe Boussole ship",
        ],
    },

    # ---------------------------------------------------------------------
    # The second wave. Every URL below was fetched and every archive.org item
    # inspected before it was written here — see docs/LIBRARY_QUEUE.md for the
    # reasoning, and whitelist.verify_source() for the gate that re-checks it
    # at fetch time. Editions matter more than titles: three of the first
    # proposals for this list were the right famous book in an unusable
    # edition.
    # ---------------------------------------------------------------------

    # Magellan/Elcano — Pigafetta sailed the whole circumnavigation and was one
    # of the eighteen who came home. Stanley's Hakluyt translation, 1874.
    "magellan-1519": {
        "texts": [
            {"kind": "gutenberg",
             "title": "Pigafetta — The First Voyage Round the World (trans. Lord Stanley of Alderley, Hakluyt Society, 1874)",
             "url": "https://www.gutenberg.org/cache/epub/74723/pg74723.txt",
             "source_url": "https://www.gutenberg.org/ebooks/74723",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Magellan expedition", "Ferdinand Magellan", "Antonio Pigafetta",
                        "Juan Sebastián Elcano", "Strait of Magellan", "Battle of Mactan",
                        "Lapulapu", "Victoria (ship)"]},
        ],
        "image_queries": [
            "Ferdinand Magellan portrait",
            "Victoria ship circumnavigation 1522",
            "Strait of Magellan early map",
            "Antonio Pigafetta",
            "Battle of Mactan Lapulapu",
        ],
    },

    # Columbus — NOT the Dunn & Kelley edition (Univ. of Oklahoma Press 1989,
    # lending-restricted). This is the Original Narratives volume of 1906,
    # which carries the Las Casas abstract of the first voyage, Dr. Chanca on
    # the second, Las Casas on the third, the fourth voyage, the Cabot
    # documents and the Saga of Eric the Red.
    "columbus-1492": {
        "texts": [
            {"kind": "gutenberg",
             "title": "The Northmen, Columbus and Cabot, 985–1503 (ed. Olson & Bourne, Original Narratives of Early American History, 1906)",
             "url": "https://www.gutenberg.org/cache/epub/18571/pg18571.txt",
             "source_url": "https://www.gutenberg.org/ebooks/18571",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Voyages of Christopher Columbus", "Christopher Columbus",
                        "Santa María (ship)", "Guanahani", "Taíno",
                        "Bartolomé de las Casas", "La Navidad", "Hispaniola"]},
        ],
        "image_queries": [
            "Christopher Columbus portrait",
            "Santa Maria Nina Pinta ship",
            "Taino people Caribbean",
            "Columbus landfall 1492 engraving",
            "Bartolome de las Casas",
        ],
    },

    # Cartier — Biggar's 1924 edition for the Public Archives of Canada: all
    # three voyages in English, originals facing, dated marginal notes. Chosen
    # over the French Gutenberg texts (#23801, #12356), which are equally
    # public domain but cover only the first two voyages and would put the
    # excerpts in a language the rest of the atlas does not use (Carta §4).
    "cartier-1534": {
        "texts": [
            {"kind": "archive",
             "title": "The Voyages of Jacques Cartier (ed. H. P. Biggar, Public Archives of Canada, 1924)",
             "url": "https://archive.org/download/voyagesofjacques0000cart_f4g3/voyagesofjacques0000cart_f4g3_djvu.txt",
             "source_url": "https://archive.org/details/voyagesofjacques0000cart_f4g3",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Jacques Cartier", "Hochelaga (village)", "Stadacona",
                        "Donnacona", "St. Lawrence Iroquoians", "Gulf of Saint Lawrence"]},
        ],
        "image_queries": [
            "Jacques Cartier portrait",
            "Hochelaga Ramusio plan 1556",
            "St Lawrence Iroquoians",
            "Cartier Gaspe cross 1534",
        ],
    },

    # Pizarro — Markham's 1872 Hakluyt volume, carrying Francisco de Xerez
    # (Pizarro's own secretary, present at Cajamarca) and Pedro Sancho. An
    # earlier reconnaissance reported no public-domain source for Peru; it had
    # been open on archive.org for years.
    "pizarro-1532": {
        "texts": [
            {"kind": "archive",
             "title": "Reports on the Discovery of Peru — Xerez and Sancho (trans. Clements R. Markham, Hakluyt Society, 1872)",
             "url": "https://archive.org/download/reportsondiscove00markrich/reportsondiscove00markrich_djvu.txt",
             "source_url": "https://archive.org/details/reportsondiscove00markrich",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Spanish conquest of the Inca Empire", "Francisco Pizarro",
                        "Atahualpa", "Battle of Cajamarca", "Inca Empire", "Cusco",
                        "Quipu"]},
        ],
        "image_queries": [
            "Francisco Pizarro portrait",
            "Atahualpa Inca emperor",
            "Battle of Cajamarca 1532",
            "Inca Cusco architecture",
            "Quipu Inca record",
        ],
    },

    # Darwin — a voyage of observation rather than of conquest, and the only
    # one in the atlas whose cargo home was an idea.
    "darwin-1831": {
        "texts": [
            {"kind": "gutenberg",
             "title": "Charles Darwin — The Voyage of the Beagle (Journal of Researches)",
             "url": "https://www.gutenberg.org/cache/epub/944/pg944.txt",
             "source_url": "https://www.gutenberg.org/ebooks/944",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Second voyage of HMS Beagle", "Charles Darwin", "HMS Beagle",
                        "Robert FitzRoy", "Galápagos Islands", "Jemmy Button",
                        "Tierra del Fuego"]},
        ],
        "image_queries": [
            "Charles Darwin young portrait",
            "HMS Beagle ship",
            "Galapagos finches Darwin",
            "Tierra del Fuego Fuegians Beagle",
            "Robert FitzRoy",
        ],
    },

    # Xuanzang — the great overland journey, and the atlas's first non-European
    # traveller. Deliberately early rather than "later": an atlas that reaches
    # thirty European voyages before admitting one from anywhere else makes every
    # subsequent addition read as a correction.
    #
    # Beal's 1884 translation, both volumes in one scan (Digital Library of
    # India, unrestricted, gate-verified). Note the Victorian transliterations —
    # Hiuen Tsiang for Xuanzang, Kanauj, Kucha — which the gazetteer will need
    # help with.
    "xuanzang-629": {
        "texts": [
            {"kind": "archive",
             "title": "Si-Yu-Ki: Buddhist Records of the Western World, Vols I–II "
                      "(trans. Samuel Beal, 1884)",
             "url": "https://archive.org/download/in.ernet.dli.2015.49333/"
                    "2015.49333.Buddhist-Records-Of-The-Western-World--Vol-1-2_djvu.txt",
             "source_url": "https://archive.org/details/in.ernet.dli.2015.49333",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Xuanzang", "Great Tang Records on the Western Regions",
                        "Nalanda", "Bamiyan", "Gandhara", "Kingdom of Khotan",
                        "Silk Road", "Harsha"]},
        ],
        "image_queries": [
            "Xuanzang portrait",
            "Nalanda ruins",
            "Bamiyan Buddhas",
            "Silk Road Tang dynasty map",
            "Big Wild Goose Pagoda Xian",
        ],
    },

    # Shackleton — Worsley's navigation makes the positions unusually exact for
    # a voyage that spent most of itself without a ship.
    "shackleton-1914": {
        "texts": [
            {"kind": "gutenberg",
             "title": "Ernest Shackleton — South: The Story of Shackleton's Last Expedition 1914–1917",
             "url": "https://www.gutenberg.org/cache/epub/5199/pg5199.txt",
             "source_url": "https://www.gutenberg.org/ebooks/5199",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Imperial Trans-Antarctic Expedition", "Ernest Shackleton",
                        "Endurance (1912 ship)", "Elephant Island", "South Georgia",
                        "Frank Worsley", "Frank Hurley", "Ross Sea party"]},
        ],
        "image_queries": [
            "Ernest Shackleton portrait",
            "Endurance ship ice Hurley",
            "Elephant Island Shackleton",
            "James Caird boat South Georgia",
            "Frank Hurley Antarctic photograph",
        ],
    },

    # ---- third wave: the spine, the cultural void, and the unused tiers ----

    "gama-1497": {
        "texts": [
            {"kind": "gutenberg",
             "title": 'A Journal of the First Voyage of Vasco da Gama, 1497-1499 (trans. E. G. Ravenstein, Hakluyt Society, 1898)',
             "url": "https://www.gutenberg.org/cache/epub/46440/pg46440.txt",
             "source_url": "https://www.gutenberg.org/ebooks/46440",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Vasco da Gama', 'Cape Route', 'Calicut', 'Malindi', 'Kingdom of Portugal', 'Zamorin of Calicut']},
        ],
        "image_queries": ['Vasco da Gama portrait', 'Sao Gabriel ship', 'Calicut 15th century', 'Padrao pillar Portuguese'],
    },

    "drake-1577": {
        "texts": [
            {"kind": "archive",
             "title": 'The World Encompassed by Sir Francis Drake (Hakluyt Society, 1854)',
             "url": "https://archive.org/download/worldencompassed16drak/worldencompassed16drak_djvu.txt",
             "source_url": "https://archive.org/details/worldencompassed16drak",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Francis Drake', "Francis Drake's circumnavigation", 'Golden Hind', 'Nova Albion', 'Strait of Magellan']},
        ],
        "image_queries": ['Francis Drake portrait', 'Golden Hind ship', 'Drake circumnavigation map'],
    },

    # Marco Polo — MARSDEN, not Yule. The Yule/Cordier edition is the scholarly
    # standard and it is unusable here: it interleaves some 2,300 footnote
    # markers per volume with the text, and an extraction from it returned five
    # of its first eight excerpts as Yule's own commentary — one of them an
    # index line, "Venice, 18; find young Marco there". A voyage whose excerpts
    # are its editor's arguments misattributes the one thing this atlas
    # promises. Marsden's translation carries no apparatus at all: zero matches
    # for the note patterns that Yule fires on thousands of times.
    "polo-1271": {
        "texts": [
            {"kind": "archive",
             "title": "The Travels of Marco Polo, the Venetian (trans. William Marsden, rev. ed. 1892)",
             "url": "https://archive.org/download/travelsofmarcopo92polo/travelsofmarcopo92polo_djvu.txt",
             "source_url": "https://archive.org/details/travelsofmarcopo92polo",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ["Marco Polo", "Il Milione", "Kublai Khan", "Yuan dynasty",
                        "Silk Road", "Rustichello da Pisa"]},
        ],
        "image_queries": ["Marco Polo portrait", "Kublai Khan court",
                          "Catalan Atlas caravan"],
    },

    "ibnbattuta-1325": {
        "texts": [
            {"kind": "archive",
             "title": 'The Travels of Ibn Batuta (trans. Rev. Samuel Lee, Oriental Translation Committee, 1829)',
             "url": "https://archive.org/download/bub_gb_22IbAQAAMAAJ/bub_gb_22IbAQAAMAAJ_djvu.txt",
             "source_url": "https://archive.org/details/bub_gb_22IbAQAAMAAJ",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Ibn Battuta', 'Rihla', 'Mali Empire', 'Delhi Sultanate', 'Maldives', 'Timbuktu']},
        ],
        "image_queries": ['Ibn Battuta illustration', 'Mali Empire Mansa Musa', 'medieval Cairo', 'dhow Indian Ocean'],
    },

    "leoafricanus-1510": {
        "texts": [
            {"kind": "archive",
             "title": 'The History and Description of Africa (trans. John Pory 1600, ed. Robert Brown, Hakluyt Society, 1896)',
             "url": "https://archive.org/download/historyanddescr02porygoog/historyanddescr02porygoog_djvu.txt",
             "source_url": "https://archive.org/details/historyanddescr02porygoog",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Leo Africanus', 'Songhai Empire', 'Timbuktu', 'Fez', 'Kingdom of Morocco']},
        ],
        "image_queries": ['Leo Africanus portrait', 'Timbuktu Djinguereber', 'Fez medina', 'Songhai Empire map'],
    },

    "faxian-399": {
        "texts": [
            {"kind": "gutenberg",
             "title": 'A Record of Buddhistic Kingdoms (Faxian, trans. James Legge, 1886)',
             "url": "https://www.gutenberg.org/cache/epub/2124/pg2124.txt",
             "source_url": "https://www.gutenberg.org/ebooks/2124",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Faxian', 'Gupta Empire', 'Anuradhapura', 'Khotan', 'Pataliputra']},
        ],
        "image_queries": ['Faxian pilgrim', 'Anuradhapura stupa', 'Gupta Empire art'],
    },

    "verrazzano-1524": {
        "texts": [
            {"kind": "gutenberg",
             "title": 'The Voyage of Verrazzano (Henry Cruse Murphy, 1875)',
             "url": "https://www.gutenberg.org/cache/epub/5252/pg5252.txt",
             "source_url": "https://www.gutenberg.org/ebooks/5252",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Giovanni da Verrazzano', 'New York Bay', 'Narragansett Bay', 'Cape Fear']},
        ],
        "image_queries": ['Giovanni da Verrazzano portrait', 'La Dauphine ship', 'New York harbour 16th century'],
    },

    "mungopark-1795": {
        "texts": [
            {"kind": "archive",
             "title": 'Travels in the Interior Districts of Africa (Mungo Park, 1799)',
             "url": "https://archive.org/download/travelsininter00park/travelsininter00park_djvu.txt",
             "source_url": "https://archive.org/details/travelsininter00park",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Mungo Park (explorer)', 'Niger River', 'Segou', 'African Association', 'Atlantic slave trade']},
        ],
        "image_queries": ['Mungo Park explorer portrait', 'Niger river 18th century', 'Segou Mali'],
    },

    "lewisclark-1804": {
        "texts": [
            {"kind": "gutenberg",
             "title": 'The Journals of Lewis and Clark, 1804-1806',
             "url": "https://www.gutenberg.org/cache/epub/8419/pg8419.txt",
             "source_url": "https://www.gutenberg.org/ebooks/8419",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['Lewis and Clark Expedition', 'Meriwether Lewis', 'William Clark', 'Sacagawea', 'Corps of Discovery', 'Columbia River']},
        ],
        "image_queries": ['Lewis and Clark expedition', 'Sacagawea', 'Corps of Discovery keelboat'],
    },

    "cabot-1497": {
        "texts": [
            {"kind": "gutenberg",
             "title": 'The Northmen, Columbus and Cabot, 985-1503 — the Pasqualigo and Soncino letters (ed. Olson & Bourne, 1906)',
             "url": "https://www.gutenberg.org/cache/epub/18571/pg18571.txt",
             "source_url": "https://www.gutenberg.org/ebooks/18571",
             "license": "Public domain"},
            {"kind": "wikipedia", "lang": "en", "license": "CC BY-SA 4.0",
             "titles": ['John Cabot', 'Matthew (ship)', 'Newfoundland', 'Bristol']},
        ],
        "image_queries": ['John Cabot portrait', 'Matthew ship Bristol', 'Newfoundland coast historic'],
    },

}

IMAGES_PER_QUERY = 2
