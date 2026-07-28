"""Deciding whether a quotation is in its source, and what the source says.

Shared by the ingestion pipeline and the Curator gate, which used to hold two
copies of this logic and had already drifted: the pipeline enforced Carta v0.5
while the Curator still enforced v0.1, so a draft the pipeline built could not
pass the gate that re-checks it. A gate applying a different rule than the check
it audits is not a gate.

Imports nothing outside the standard library on purpose — curator.py must run
without psycopg2 or the AXIS package, which is why the duplication existed.

The contract, in one line: **a scribe chooses which passage matters; the source
says what it contains.** Matching is deliberately generous, because a scan and a
transcription of it differ in case, in quotation marks, in ligatures, in
whitespace and in where words break. Publication is exact, because
locate_in_source copies the span out of the source rather than trusting what
the quoter typed. Being generous in the first is only safe because of the
second.
"""
from __future__ import annotations

import re
import unicodedata


def _fold_punct(ch):
    return {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
            "\u2014": "-", "\u2013": "-"}.get(ch, ch)


def _newlines(s, a, b):
    """Line endings inside a whitespace run, counting the separators an OCR of
    a printed page actually produces."""
    return sum(s.count(c, a, b) for c in ("\n", "\r", "\f", "\u2028", "\u2029"))


def _breaks_word(s, ws_start, ws_end):
    """Could this hyphen-then-whitespace be a word the margin divided?

    Used ONLY for matching, where the job is retrieval: find the passage the
    scribe meant. Generous on purpose, and safe because nothing the scribe
    types is published — the span is copied out of the source afterwards.

    Blank lines are allowed here and refused in the publication rule below.
    "inter-\n\nnational" is a paragraph break, which does not divide a word;
    "to en-\n\n\ntreat" is a PAGE break, which does, and in an OCR the two are
    the same characters. Refusing both cost a real La Pérouse quotation and
    reported it as "fabricated or altered"."""
    nxt = s[ws_end] if ws_end < len(s) else ""
    k = ws_start - 2
    return bool(nxt) and nxt.isalpha() and k >= 0 and s[k].isalpha()


def _division_is_unambiguous(s, ws_start, ws_end):
    """Is the hyphen certainly the margin's, rather than the word's?

    Used for publication, where a wrong answer prints a word the source never
    had, so every condition here is a refusal to guess:

      - there must be a line ending. "ice- bound" is a hyphen and a space, and
        a space is not a margin. The whole corpus of La Pérouse's 1799 edition
        holds 1,811 hyphens at a line ending and 67 followed only by spaces,
        so guessing at the second buys almost nothing and costs real words.
      - exactly one line ending. Two is a paragraph or a page, and neither is
        close enough to be sure.
      - lower case on both sides. A capital either way is X-ray, Anglo-Saxon,
        T-shirt: the printer's hyphen, not the margin's.

    It still cannot tell "north-\neast" from "anchor-\ned", and nothing without
    the page's geometry can. That case rejoins, and it is the declared limit of
    Carta 3.4 rather than a defect hidden inside it."""
    if not _breaks_word(s, ws_start, ws_end):
        return False
    if _newlines(s, ws_start, ws_end) != 1:
        return False
    return s[ws_end].islower() and s[ws_start - 2].islower()


def _for_reading(raw):
    """The source's own span, with only what the line endings did to it undone.

    Everything else survives: capitalisation, punctuation, spelling, ligatures,
    the printer's hyphens, runs of spaces, and the boundaries between
    paragraphs. An earlier version treated every isspace() as typographic
    damage and so deleted paragraph breaks, form feeds and double spaces —
    changes Carta 3.4 does not license and which an adversarial review
    demonstrated one by one.

    Returns the readable span and the list of transformations actually applied,
    so provenance can name them instead of asserting a default."""
    out, done, i, n = [], [], 0, len(raw)
    while i < n:
        ch = raw[i]
        if not ch.isspace():
            out.append(ch)
            i += 1
            continue
        j = i
        while j < n and raw[j].isspace():
            j += 1
        nl = _newlines(raw, i, j)
        if nl == 0:
            # Spaces and tabs inside a line are the source's own spacing.
            out.append(raw[i:j])
        elif out and out[-1] == "-" and nl == 1 and _breaks_word(raw, i, j):
            if _division_is_unambiguous(raw, i, j):
                out.pop()
                done.append("line-break-rejoin")
            else:
                # The hyphen might be the printer's, so it stays — but the line
                # ending is not part of the word either way, and turning it
                # into a space would print "X- ray", which is on no page.
                done.append("line-break-closed")
        elif nl == 1:
            out.append(" ")
            done.append("line-wrap-to-space")
        else:
            # A paragraph or a page. Keeping it is the only honest rendering:
            # it is a boundary the page has, and collapsing it invents prose
            # the author did not write.
            out.append("\n\n")
            done.append("paragraph-break-kept")
        i = j
    text = "".join(out).strip()
    return text, sorted(set(done))


def _norm_with_origins(s):
    """The matching form of a text, plus where every surviving character came
    from.

    The whole point of the comparison is to find a span in the source. Doing
    that and then publishing the QUOTER's text instead of the source's was the
    defect underneath every false positive an external review found: the
    matcher folds case, unifies dashes and quotes, decomposes ligatures and
    collapses whitespace — it always has — so a scribe writing "the voyage
    began." against a page printing "The Voyage began." matched, and the
    lowercase version was what got published.

    Returning the origin index of each normalised character lets the pipeline
    copy the span out of the source instead. Then capitalisation, dashes,
    ligatures and hyphenation are the source's by construction, and no
    normalisation performed here can alter a published word."""
    out, origins = [], []

    def push(text, at):
        for ch in text:
            out.append(ch)
            origins.append(at)

    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if ch.isspace():
            j = i
            while j < n and s[j].isspace():
                j += 1
            if out and out[-1] == "-" and j < n and _breaks_word(s, i, j):
                out.pop(); origins.pop()
            elif out:
                push(" ", i)
            i = j
            continue
        # Every hyphen inside a word is dropped for matching purposes, on both
        # sides. Where a source breaks "X-ray" at the margin, one scribe writes
        # "X-ray" and another "Xray" and both mean the same passage; deciding
        # which is "right" is undecidable and, since the span is copied out of
        # the source, pointless.
        folded = _fold_punct(ch)
        if folded in "-\u2010\u00ad" and out and out[-1].isalnum() \
                and i + 1 < n and s[i + 1].isalnum():
            i += 1
            continue
        push(unicodedata.normalize("NFKC", folded).casefold(), i)
        i += 1
    while out and out[-1] == " ":
        out.pop(); origins.pop()
    start = 0
    while start < len(out) and out[start] == " ":
        start += 1
    return "".join(out[start:]), origins[start:]


def locate_in_source(quote, source):
    """Find a quotation in its source and return what the SOURCE says.

    Returns (raw_span, reading_span, transformations) or (None, None, None).
    Both spans are copied out of the source: `raw_span` character for
    character, and `reading_span` with only what the line endings did undone.
    `transformations` names what was actually applied to get from one to the
    other — never a default, because a provenance field that always says the
    same thing records nothing.

    This is the only thing allowed to decide what a diary_excerpt contains.
    A scribe chooses which passage matters; it does not get to retype it."""
    hay, origins = _norm_with_origins(source)
    needle, _ = _norm_with_origins(quote)
    if not needle:
        return None, None, None
    # Token boundaries. A bare find() matched "the" inside "other" and returned
    # a span starting mid-word, which is a citation to something the source
    # does not say.
    at = -1
    probe = hay.find(needle)
    while probe >= 0:
        before_ok = probe == 0 or not hay[probe - 1].isalnum()
        after = probe + len(needle)
        after_ok = after >= len(hay) or not hay[after].isalnum()
        if before_ok and after_ok:
            at = probe
            break
        probe = hay.find(needle, probe + 1)
    if at < 0:
        return None, None, None
    raw = source[origins[at]:origins[at + len(needle) - 1] + 1]
    reading, transformations = _for_reading(raw)
    return raw, reading, transformations


def norm(s):
    """The matching form of a text. Retrieval only — never publication.

    Folds case, unifies quotes and dashes, decomposes ligatures, collapses
    whitespace and ignores hyphenation, because the job here is to find the
    passage a scribe meant and every one of those varies between a scan and a
    transcription of it. It is safe to be this generous ONLY because
    locate_in_source copies the published span out of the source afterwards:
    nothing a quoter typed survives into the atlas."""
    return _norm_with_origins(s)[0]



# ---------------------------------------------------------------- source text

class UnverifiableSource(Exception):
    """The source cannot be reduced to what a reader would see."""


def source_text(body: str, content_type: str = "") -> str:
    """The text a quotation may be checked against.

    Plain text passes through untouched. HTML is refused.

    Both halves of that were learned the hard way. Stripping markup with a
    regex looks like it works and does not: an unclosed <script>, a <template>,
    a hidden element, a crafted comment and a quoted attribute all survive it,
    so a quotation invisible on the page verifies as though a reader could see
    it — an external review demonstrated five bypasses in a row. And deciding
    "this is markup" by looking for a "<" destroys plain text: eight stray
    angle brackets in an OCR'd 1929 book cost 318,658 characters, forty per
    cent of the volume, after which four genuine quotations were reported as
    "fabricated or altered".

    So neither guess is made. The Content-Type decides, and an HTML source is
    declared unverifiable rather than half-parsed. Nothing is lost by this:
    every source in the atlas is a Gutenberg .txt or an archive.org _djvu.txt,
    which is what a citable edition looks like anyway. If an HTML source ever
    matters, it needs a real parser and a real renderer, not this."""
    ct = content_type.lower()
    if "html" in ct or "xml" in ct:
        raise UnverifiableSource(
            "the source is served as " + (content_type or "markup") + ". A quotation "
            "cannot be verified against markup: text hidden in a script, a template, "
            "an attribute or a comment is not on the page a reader opens, and no "
            "regular expression can tell the difference. Cite the plain-text edition "
            "— for Project Gutenberg the .txt, for archive.org the _djvu.txt.")
    return body


def readable_text(body: str, content_type: str = "") -> str:
    """Deprecated alias kept for one release. Use source_text."""
    return source_text(body, content_type)
