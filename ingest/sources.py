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
}

IMAGES_PER_QUERY = 2
