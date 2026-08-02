"""Codex Hunters — Restorer and Binder, adapted from vitruvyan-core (canonical
domain: `codex_hunters/consumers/{restorer,binder}.py`) to text corpora.

The canonical pattern runs Tracker → Restorer → Binder. Terraveler's Tracker
was already here in another name: load_sources/fetch harvest over the
whitelist and record what they found. What was missing is what the canonical
pipeline does next — structural repair, a scored quality gate, and binding
editions to a work — all through the audit trace rather than silently.

Two boundaries the canonical Restorer draws, kept here:

  - Restoration is not judgment. Structural repair only — never content
    filtering, which is the Curator's mandate (curate.py), spent as one LLM
    call per discovered candidate. Codex spends nothing: it is deterministic
    by principle (AGENTS.md §5), because none of this is a hard call.
  - The raw form survives beside the normalized one for the length of the
    run, so the trace can show what changed — but only the normalized form
    flows downstream. The raw is never persisted twice; it is the live
    source, re-fetchable.

One deliberate departure from the canonical shape: the canonical Binder
dedupes silently. Terraveler's rule is that every drop is auditable
(AGENTS.md §3) — a corpus that lost a source without saying so is exactly
the failure load_sources_node's fetch handling exists to prevent. So here,
dedupe is a Rejection, always naming the twin that was kept.
"""
import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urlparse

from axis.state import Fact, Decision, Rejection


def _now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- restoration
_CONTROL_ALLOWED = {"\n", "\t"}


def normalize_text(raw: str) -> str:
    """Structural repair, and nothing else.

    Unicode NFC; drop control characters other than newline/tab; collapse
    3+ blank lines to 2; strip trailing whitespace per line. Never
    de-hyphenates, never touches punctuation or case — quotations are
    relocated against live sources at quote time (Carta §3.4); the corpus
    itself stays as close to the source as structural cleanup allows.
    """
    t = unicodedata.normalize("NFC", raw)
    t = "".join(ch for ch in t if ch in _CONTROL_ALLOWED or unicodedata.category(ch)[0] != "C")
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = "\n".join(line.rstrip() for line in t.split("\n"))
    return t


def sha12(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


# Quality gate. Names mirror the canonical config surface (CodexConfig.quality
# in vitruvyan-core) even though Terraveler hardcodes them — one pipeline, one
# policy, not a per-tenant config object.
MIN_BODY_CHARS = 500                 # config.quality.min_body_chars (ours, not canonical)
REPLACEMENT_RATIO_MAX = 0.005        # config.quality.max_replacement_ratio
GUTENBERG_BOILERPLATE_MARKERS = ("*** START OF", "*** END OF")
QUALITY_PENALTY_PER_ERROR = 0.3      # config.quality.penalty_per_error
QUALITY_THRESHOLD_VALID = 0.5        # config.quality.threshold_valid


def quality_errors(body: str) -> list:
    """Structural validity checks only — about the artifact, never its
    meaning. A text that is short, garbled, or still carrying its Gutenberg
    header is a restoration failure; a text that says something wrong is a
    Curator problem, not this one's."""
    errors = []
    if len(body) < MIN_BODY_CHARS:
        errors.append(f"body {len(body)} chars < {MIN_BODY_CHARS} after normalization")
    if body:
        ratio = body.count("\ufffd") / len(body)
        if ratio > REPLACEMENT_RATIO_MAX:
            errors.append(
                f"replacement-char ratio {ratio:.2%} > {REPLACEMENT_RATIO_MAX:.2%}")
    for marker in GUTENBERG_BOILERPLATE_MARKERS:
        if marker in body:
            errors.append(f"residual Gutenberg boilerplate marker {marker!r} in body")
    return errors


def quality_score(errors: list) -> float:
    return max(0.0, min(1.0, 1.0 - QUALITY_PENALTY_PER_ERROR * len(errors)))


# ---------------------------------------------------------------- dedupe
SHINGLE_SIZE = 8
NEAR_DUP_JACCARD = 0.90


def _shingles(text: str) -> set:
    words = re.findall(r"\S+", text.lower())
    if len(words) < SHINGLE_SIZE:
        return {tuple(words)} if words else set()
    return {tuple(words[i:i + SHINGLE_SIZE]) for i in range(len(words) - SHINGLE_SIZE + 1)}


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def _prefer(a: dict, b: dict) -> bool:
    """True if entry `a` should be kept over `b`: public domain outranks CC,
    and between two of the same standing the longer text is kept."""
    a_pd = a["license"].strip().lower() == "public domain"
    b_pd = b["license"].strip().lower() == "public domain"
    if a_pd != b_pd:
        return a_pd
    return len(a["body"]) > len(b["body"])


def dedupe_key(title: str, url: str, content_hash: str) -> str:
    """The canonical shape (Codex Hunters Binder): a deterministic key over
    identity + a content fingerprint, never over a timestamp."""
    basis = f"{title}:{url}:{content_hash[:8]}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


def _dedupe_texts(entries: list) -> tuple:
    """Exact dedupe by normalized-body hash, then near dedupe by 8-word
    shingle Jaccard within the same run (the case that matters: one edition,
    transcribed or OCR'd by two different archives). Returns (kept, drops)
    where drops is [(description, reason), ...]."""
    kept = []
    seen_hashes = {}
    drops = []
    for e in entries:
        dup_at = seen_hashes.get(e["content_hash"])
        if dup_at is not None:
            twin = kept[dup_at]
            drops.append((
                e["title"][:56],
                f"codex: exact duplicate of '{twin['title'][:50]}' ({twin['url']})"))
            continue
        near_at, near_score = None, 0.0
        for i, k in enumerate(kept):
            score = _jaccard(e["shingles"], k["shingles"])
            if score >= NEAR_DUP_JACCARD:
                near_at, near_score = i, score
                break
        if near_at is not None:
            twin = kept[near_at]
            if _prefer(e, twin):
                drops.append((
                    twin["title"][:56],
                    f"codex: near-duplicate (jaccard={near_score:.2f}) of "
                    f"'{e['title'][:50]}' ({e['url']}) — the latter kept"))
                kept[near_at] = e
                seen_hashes[e["content_hash"]] = near_at
            else:
                drops.append((
                    e["title"][:56],
                    f"codex: near-duplicate (jaccard={near_score:.2f}) of "
                    f"'{twin['title'][:50]}' ({twin['url']})"))
            continue
        seen_hashes[e["content_hash"]] = len(kept)
        kept.append(e)
    return kept, drops


# ---------------------------------------------------------------- binding
_GUTENBERG_PREFIX_RE = re.compile(r"^\s*The\s+Project\s+Gutenberg\s+e?[Bb]ook\s+of\s+(the\s+)?", re.I)
_ARCHIVE_PREFIX_RE = re.compile(r"^\s*Full\s+text\s+of\s+", re.I)
# A parenthesised group carrying a year is edition metadata (translator,
# publisher, printing) — not part of the work's identity.
_PAREN_YEAR_RE = re.compile(r"\s*\([^()]*\b(?:1[4-9]\d{2}|20\d{2})\b[^()]*\)")
_VOLUME_RE = re.compile(r",?\s*\bVol(?:s|ume)?\.?\s+[IVXLCM]+(?:\s*[-–—]\s*[IVXLCM]+)?\.?", re.I)
_TAIL_SEP_RE = re.compile(r"\s[—|]\s")  # em dash or pipe, spaced — a publisher tail
_WIKIPEDIA_PREFIX_RE = re.compile(r"^Wikipedia\s+—\s+", re.I)


def normalize_work_title(title: str) -> str:
    """Reduce a title to the part that identifies the WORK, stripping the
    parts that only identify one edition of it: eBook/scan boilerplate,
    volume markers, parenthesised translator/publisher/year, and an
    author/publisher segment split off by an em dash or pipe.

    That last step used to cut at the last separator and keep what came
    before it — which assumed "Author — Title" order. sources.py does not
    hold to that order: "Bougainville — A Voyage Round the World" is
    author-first, but "Reports on the Discovery of Peru — Xerez and Sancho"
    is title-first, and cutting at the separator kept the author in the
    first case ("Diderot — Supplément au Voyage de Bougainville" collapsed
    to the work "diderot", which would have silently merged with anything
    else Diderot wrote). A title is almost always longer than an author name
    or a publisher tail, so the longest segment is kept instead — a
    heuristic, not a guarantee; sources.py may override it with an explicit
    "work" key when it isn't enough (see codex_bind_node)."""
    t = _GUTENBERG_PREFIX_RE.sub("", title)
    t = _ARCHIVE_PREFIX_RE.sub("", t)
    t = _PAREN_YEAR_RE.sub("", t)
    t = _VOLUME_RE.sub("", t)
    segments = _TAIL_SEP_RE.split(t)
    if len(segments) > 1:
        t = max(segments, key=lambda seg: len(seg.strip()))
    t = re.sub(r"[,:;\s]+$", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _slugify(s: str) -> str:
    # Unicode dashes become hyphens BEFORE the ascii-ignore pass, which would
    # otherwise drop them entirely: "985–1503" (en dash) slugified to
    # "9851503" while "985-1503" kept its separator, so the same compilation
    # titled both ways across two voyage configs landed on two work_ids.
    s = re.sub(r"[‐-―−]", "-", s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower() or "untitled"


def _is_wikipedia_url(url: str) -> bool:
    return (urlparse(url).netloc or "").lower().endswith("wikipedia.org")


def work_id_for(title: str, url: str) -> str:
    """The bound identity for a text is the WORK, not the edition. Every
    Wikipedia article is its own work; every other text binds by its
    normalized title, so two editions of the same book — different archive,
    different scan, sometimes a different language — land on one work_id."""
    if _is_wikipedia_url(url):
        article = _WIKIPEDIA_PREFIX_RE.sub("", title)
        return "wikipedia-" + _slugify(article)
    return _slugify(normalize_work_title(title))


# ---------------------------------------------------------------- nodes
def codex_restore_node(ctx, corpus):
    """The canonical Restorer: structural repair, a scored quality gate, and
    dedupe — the audit trace records what raw looked like, what changed, and
    every drop with its reason. Text-only; image docs get their own (much
    simpler) exact dedupe by media_url in the same pass, since they never had
    a body to restore."""
    def node(state):
        candidates = []
        n_invalid = 0
        # The 5th slot is an explicit work override from source config, not
        # yet a work_id (codex_bind_node hasn't run) — carried through
        # unchanged so a source that named its work still gets to.
        for title, url, body, lic, work_override in corpus.raw_texts:
            raw_hash = sha12(body)
            norm_body = normalize_text(body)
            norm_hash = sha12(norm_body)
            state = state.with_decision(Decision(
                f"codex: restored '{title[:50]}' — raw sha256:{raw_hash} "
                f"({len(body)} chars) → normalized sha256:{norm_hash} "
                f"({len(norm_body)} chars)", _now()))

            errors = quality_errors(norm_body)
            score = quality_score(errors)
            if score < QUALITY_THRESHOLD_VALID:
                n_invalid += 1
                state = state.with_rejection(Rejection(
                    title, f"codex: INVALID, quality={score:.1f} — "
                    + "; ".join(errors), _now()))
                continue
            candidates.append({
                "title": title, "url": url, "body": norm_body, "license": lic,
                "content_hash": norm_hash, "shingles": _shingles(norm_body),
                "work_override": work_override})

        kept, drops = _dedupe_texts(candidates)
        for desc, reason in drops:
            state = state.with_rejection(Rejection(desc, reason, _now()))

        corpus.raw_texts = []
        for e in kept:
            dkey = dedupe_key(e["title"], e["url"], e["content_hash"])
            state = state.with_decision(Decision(
                f"codex: kept '{e['title'][:50]}' — dedupe_key={dkey}", _now()))
            corpus.raw_texts.append(
                (e["title"], e["url"], e["body"], e["license"], e["work_override"]))

        seen_media = set()
        kept_docs = []
        n_img_dropped = 0
        for d in corpus.docs:
            if d.get("type") == "image":
                mu = d.get("media_url")
                if mu in seen_media:
                    n_img_dropped += 1
                    state = state.with_rejection(Rejection(
                        d.get("title") or mu, f"codex: exact duplicate media_url {mu}", _now()))
                    continue
                seen_media.add(mu)
            kept_docs.append(d)
        corpus.docs = kept_docs

        n_deduped = (len(candidates) - len(kept)) + n_img_dropped
        state = state.with_fact(Fact("codex_invalid", n_invalid, "codex_restore", _now()))
        state = state.with_fact(Fact("codex_deduped", n_deduped, "codex_restore", _now()))
        state = state.with_fact(Fact("codex_kept", len(kept), "codex_restore", _now()))
        state = state.with_decision(Decision(
            f"codex: restored {len(kept)}/{len(corpus.raw_texts) + n_invalid + len(drops)} "
            f"texts ({n_invalid} invalid, {n_deduped} deduped)", _now()))
        return state
    node.__name__ = "codex_restore"
    return node


def codex_bind_node(ctx, corpus):
    """The canonical Binder: bind each surviving text to its WORK. Two texts
    landing on the same work_id under different urls are editions of one
    work — the canonical BoundEntity.relations "edition-of" edge, recorded
    here as a Decision rather than a table, at this scale.

    The title heuristic (normalize_work_title) cannot bind cross-language
    editions — an English and a French title share no text to compare, only
    a subject. sources.py may name the work explicitly (`"work": "<slug>"`)
    for exactly that case; the override wins verbatim over the heuristic,
    and every explicit bind is recorded so it reads as a decision rather
    than a coincidence. Discovery-mode candidates carry no such config, so
    the heuristic is all they get — correctly."""
    def node(state):
        works = {}
        new_raw = []
        for title, url, body, lic, work_override in corpus.raw_texts:
            if work_override:
                wid = work_override
                state = state.with_decision(Decision(
                    f"codex: explicit work override for '{title[:50]}' — "
                    f"work_id={wid} (sources.py \"work\" key)", _now()))
            else:
                wid = work_id_for(title, url)
            works.setdefault(wid, []).append((title, url))
            new_raw.append((title, url, body, lic, wid))
        corpus.raw_texts = new_raw

        for d in corpus.docs:
            if d.get("type") == "image":
                d["work_id"] = None

        n_multi = 0
        for wid, editions in works.items():
            if len(editions) > 1:
                n_multi += 1
                names = "; ".join(f"{t[:40]} ({u})" for t, u in editions)
                state = state.with_decision(Decision(
                    f"codex: work '{wid}' bound {len(editions)} editions — {names}", _now()))

        state = state.with_fact(Fact("codex_works", len(works), "codex_bind", _now()))
        state = state.with_decision(Decision(
            f"codex: bound {len(corpus.raw_texts)} texts into {len(works)} works "
            f"({n_multi} multi-edition)", _now()))
        return state
    node.__name__ = "codex_bind"
    return node
