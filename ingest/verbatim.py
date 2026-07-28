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


def _breaks_word(s, ws_start, ws_end):
    """Could this hyphen-then-whitespace be a word the margin divided?

    Used ONLY for matching, where the job is retrieval: find the passage the
    scribe meant. Being generous here is safe because nothing the scribe typed
    is published — the span is copied out of the source afterwards. It is the
    publication rule below that has to be careful.

    Blank lines are allowed here and refused in the publication rule below.
    "inter-\n\nnational" is a paragraph break, which does not divide a word —
    but "to en-\n\n\ntreat" is a PAGE break, which does, and in an OCR the two
    are the same characters. La Pérouse's vol. II breaks exactly that way, with
    a running head and a page number sitting in the gap. Refusing both cost a
    real quotation and reported it as "fabricated or altered".

    So matching accepts them, because a false negative here is an accusation of
    forgery; publication refuses them, because a false positive there prints a
    word the page never had. The generous side is the safe one only because
    the published span is copied rather than typed."""
    nxt = s[ws_end] if ws_end < len(s) else ""
    k = ws_start - 2
    return bool(nxt) and nxt.isalpha() and k >= 0 and s[k].isalpha()


def _division_is_unambiguous(s, ws_start, ws_end):
    """Is the hyphen certainly the margin's, rather than the word's?

    Used for publication, where a wrong answer prints a word the source never
    had. Carta 3.4: an ambiguous hyphen stays. A capital on either side is the
    signal that the hyphen is lexical — "an X-\nray plate", "Anglo- Saxon" —
    so those keep their hyphen and lose only the line break.

    It still cannot tell "north-\neast" from "anchor-\ned", and nothing
    without the page's geometry can. That case rejoins, and it is the known
    limit of the clause rather than a defect hidden inside it."""
    if not _breaks_word(s, ws_start, ws_end):
        return False
    if s.count("\n", ws_start, ws_end) > 1:
        return False        # a paragraph or a page break: too far to be sure
    return s[ws_end].islower() and s[ws_start - 2].islower()


def _norm_with_origins(s):
    """norm(), plus where every surviving character came from.

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
    normalisation the matcher performs can alter a published word."""
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
            # A word the margin divided: drop the hyphen and the break with it.
            if out and out[-1] == "-" and j < n and _breaks_word(s, i, j):
                out.pop(); origins.pop()
            elif out:
                push(" ", i)
            i = j
            continue
        # Every hyphen inside a word is dropped for matching purposes, on both
        # sides. Where a source breaks "X-ray" at the margin, one scribe writes
        # "X-ray" and another "Xray" and both mean the same passage; deciding
        # which is "right" is undecidable and, now that the span is copied out
        # of the source, pointless. The source's own hyphens are published
        # untouched either way — this only governs what counts as finding it.
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


def _norm_no_rejoin(s):
    """The comparison without the one transformation 3.4 permits, so the
    pipeline can record WHICH of the two a quotation matched."""
    s = unicodedata.normalize("NFKC", "".join(_fold_punct(c) for c in s))
    return re.sub(r"\s+", " ", s).strip().casefold()


def _for_reading(raw):
    """The source's own span, with only what the margin did to it undone.

    Carta 3.4 permits exactly one transformation and this is where it is
    applied — to the SOURCE's characters, never to the quoter's. Capitalisation,
    punctuation, spelling, ligatures and every hyphen the printer meant survive
    untouched, because they are copied rather than retyped. What goes is the
    line ending itself: a word the margin split is made whole, and the breaks
    become single spaces, so a quotation reads as a sentence instead of as a
    column of type.

    The raw span is kept beside it. Both are published; the reader sees this
    one, and anyone checking the citation against the scan has the other."""
    out, i, n = [], 0, len(raw)
    while i < n:
        ch = raw[i]
        if ch.isspace():
            j = i
            while j < n and raw[j].isspace():
                j += 1
            if out and out[-1] == "-" and _breaks_word(raw, i, j):
                # The break goes either way; the hyphen only when it was the
                # margin's. An ambiguous one stays and reads as what it is.
                if _division_is_unambiguous(raw, i, j):
                    out.pop()
            elif out:
                out.append(" ")
            i = j
            continue
        out.append(ch)
        i += 1
    return "".join(out).strip()


def locate_in_source(quote, source):
    """Find a quotation in its source and return what the SOURCE says.

    Returns (raw_span, reading_span, exact) or (None, None, False). Both spans
    are copied out of the source: `raw_span` character for character, and
    `reading_span` with only the margin's own damage undone. `exact` says
    whether the quotation as offered already matched without the line-break
    rejoining Carta 3.4 permits.

    This is the only thing allowed to decide what a diary_excerpt contains.
    A scribe chooses which passage matters; it does not get to retype it."""
    hay, origins = _norm_with_origins(source)
    needle, _ = _norm_with_origins(quote)
    if not needle:
        return None, None, False
    at = hay.find(needle)
    if at < 0:
        return None, None, False
    raw = source[origins[at]:origins[at + len(needle) - 1] + 1]
    exact = _norm_no_rejoin(quote) in _norm_no_rejoin(source)
    return raw, _for_reading(raw), exact


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

_SCRIPTISH = re.compile(r"(?is)<(script|style|head)\b.*?</\1\s*>")
_TAG = re.compile(r"(?s)<[^>]+>")


def readable_text(body: str, content_type: str = "") -> str:
    """What a reader would see on the page, given what the server said it sent.

    Two failures, in opposite directions, produced this function.

    A gate that matched against the raw HTTP response would verify a sentence
    that appears only in a <meta> tag or in embedded JSON — text no reader can
    see. So markup has to go.

    But deciding "this is markup" by looking for a "<" destroys plain text. An
    OCR'd 1929 book held eight stray angle brackets, and stripping everything
    between each one and the next ">" deleted 318,658 characters — forty per
    cent of the volume — after which four genuine quotations were reported as
    NOT FOUND, which this pipeline words as "fabricated or altered". Accusing a
    contributor of forgery because a scanner misread a bracket is the most
    expensive mistake this code can make.

    So the Content-Type decides, and nothing else does. When the server does not
    say, the body is left exactly as it came."""
    if "html" not in content_type.lower() and "xml" not in content_type.lower():
        return body
    return _TAG.sub(" ", _SCRIPTISH.sub(" ", body))
