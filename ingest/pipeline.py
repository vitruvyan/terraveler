"""The Terraveler ingestion pipeline as Axis Nodes.

Four pure-ish nodes run through the Axis Runner:

    load_sources → chunk → embed → upsert

GraphState carries the AUDIT (counts, decisions, rejections) — the immutable
trace the human inspects. Bulk data (chunks, vectors) flows through a side
`Corpus` object, because GraphState is a ledger, not a data bus.

Embedding is delegated to terraveler_embedding (nomic, 768-d) over the internal
Docker network; storage is pgvector. No tokens, no Qdrant.
"""
import re
import json
import time
import urllib.request
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import execute_values

from axis.state import Fact, Decision, Rejection
import fetch as F
import oculus
import curate
import whitelist as W
from sources import VOYAGE_SOURCES, IMAGES_PER_QUERY

BATCH = 32


def _now():
    return datetime.now(timezone.utc)


class Corpus:
    """Side-channel for bulk data (not part of the audit trace)."""
    def __init__(self):
        self.raw_texts = []   # (title, url, body, license)
        self.docs = []        # final embeddable docs (dicts)
        self.candidates = []  # discovery: oculus candidates
        self.kept = []        # discovery: curator-approved candidates
        self.image_terms = []


# ---------------------------------------------------------------- embed client
def _post_json(url, body, timeout=180):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _retry_call(fn, tries=4, base=1.6):
    """Exponential backoff — mirrors axis.recovery.retry, at call granularity."""
    for i in range(tries):
        try:
            return fn()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(base ** i)


def _emb_literal(vec):
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


# ---------------------------------------------------------------- nodes
def load_sources_node(ctx, corpus):
    def node(state):
        cfg = VOYAGE_SOURCES.get(ctx.voyage)
        if not cfg:
            raise ValueError(f"unknown voyage: {ctx.voyage}")
        n_txt = 0
        for s in cfg["texts"]:
            if s["kind"] in ("gutenberg", "archive"):
                # The licence gate, applied to curated sources and not only to
                # discovered ones. This config is exactly where in-copyright
                # editions get in: every one that has been proposed so far was
                # a famous book someone had good reason to trust — a 1989
                # Columbus, a 2012 Ibn Battuta reprint. Trust is not a licence.
                ok, lic = W.verify_source(s["url"])
                if not ok:
                    state = state.with_rejection(Rejection(
                        s.get("title", s["url"]), f"licence gate: {lic}", _now()))
                    continue
                # A fetch that fails must say so. Under Policy.EXPLORATION an
                # exception here was swallowed whole, so a 504 from Gutenberg
                # produced a run with no sources, no rejections, and a cheerful
                # summary — the quietest possible way to lose a corpus.
                try:
                    body = (F.fetch_gutenberg(s["url"]) if s["kind"] == "gutenberg"
                            else F.fetch_archive_text(s["url"]))
                except Exception as e:
                    state = state.with_rejection(Rejection(
                        s.get("title", s["url"]),
                        f"FETCH FAILED: {type(e).__name__}: {str(e)[:160]}", _now()))
                    continue
                # The gate's answer is a reason, not a column value. Stored as a
                # reason it becomes unfilterable — see canonical_license().
                label = W.canonical_license(lic)
                state = state.with_decision(Decision(
                    f"licence gate passed: {s.get('title', s['url'])[:60]} — "
                    f"{lic} → stored as '{label}'", _now()))
                corpus.raw_texts.append((s["title"], s.get("source_url", s["url"]), body, label))
                n_txt += 1
            elif s["kind"] == "wikipedia":
                for t in s["titles"]:
                    body = F.fetch_wikipedia(s["lang"], t)
                    url = f"https://{s['lang']}.wikipedia.org/wiki/" + t.replace(" ", "_")
                    corpus.raw_texts.append((f"Wikipedia — {t}", url, body, s["license"]))
                    n_txt += 1
        n_img = 0
        for q in cfg.get("image_queries", []):
            try:
                imgs = F.commons_images(q, IMAGES_PER_QUERY)
            except Exception as e:
                state = state.with_rejection(Rejection(
                    f"image query '{q}'", f"fetch failed: {str(e)[:120]}", _now()))
                imgs = []
            for im in imgs:
                if not im["img"]:
                    continue
                title_clean = re.sub(r"^File:|\.[A-Za-z]+$", "", im["title"]).strip()
                content = (title_clean + ". " + (im.get("desc") or "")).strip()[:1500]
                corpus.docs.append({
                    "voyage_slug": ctx.voyage, "type": "image", "title": im["title"],
                    "content": content, "source_url": im["page"], "license": im["license"],
                    "credit": im["credit"] or None, "media_url": im["img"], "chunk_index": None})
                n_img += 1
        state = state.with_fact(Fact("text_sources", n_txt, "load_sources", _now()))
        state = state.with_fact(Fact("image_docs", n_img, "load_sources", _now()))
        state = state.with_decision(Decision(
            f"Loaded {n_txt} text sources + {n_img} image docs for {ctx.voyage}", _now()))
        return state
    node.__name__ = "load_sources"
    return node


def chunk_node(ctx, corpus):
    def node(state):
        n = 0
        for title, url, body, lic in corpus.raw_texts:
            cs = F.chunk(body)
            for i, c in enumerate(cs):
                corpus.docs.append({
                    "voyage_slug": ctx.voyage, "type": "text", "title": title,
                    "content": c, "source_url": url, "license": lic,
                    "credit": None, "media_url": None, "chunk_index": i})
                n += 1
        if ctx.limit:
            corpus.docs = corpus.docs[:ctx.limit]
        state = state.with_fact(Fact("total_docs", len(corpus.docs), "chunk", _now()))
        state = state.with_decision(Decision(
            f"Chunked into {n} text chunks; corpus now {len(corpus.docs)} docs"
            + (f" (capped at {ctx.limit})" if ctx.limit else ""), _now()))
        return state
    node.__name__ = "chunk"
    return node


def embed_node(ctx, corpus):
    """Embed every doc via terraveler_embedding. Policy governs per-batch failure:
       EXPLORATION → record rejection, skip batch, continue.  STRICT → raise."""
    def node(state):
        url = ctx.embed_url.rstrip("/") + "/v1/embeddings/batch"
        embedded = 0
        rejected = 0
        docs = corpus.docs
        for start in range(0, len(docs), BATCH):
            batch = docs[start:start + BATCH]
            texts = [d["content"] for d in batch]
            try:
                resp = _retry_call(lambda: _post_json(url, {"texts": texts}))
                if not resp.get("success"):
                    raise RuntimeError(resp.get("error") or "embed returned success=false")
                vecs = resp["embeddings"]
                if len(vecs) != len(batch):
                    raise RuntimeError(f"count mismatch {len(vecs)} != {len(batch)}")
                for d, v in zip(batch, vecs):
                    d["embedding"] = _emb_literal(v)
                embedded += len(batch)
            except Exception as e:
                rejected += len(batch)
                state = state.with_rejection(Rejection(
                    f"embed batch [{start}:{start + len(batch)}]",
                    f"{str(e)[:140]}", _now()))
                if ctx.policy_name == "strict":
                    raise
        state = state.with_fact(Fact("embedded", embedded, "embed", _now()))
        state = state.with_fact(Fact("rejected", rejected, "embed", _now()))
        state = state.with_decision(Decision(
            f"Embedded {embedded} docs, {rejected} rejected (policy={ctx.policy_name})", _now()))
        return state
    node.__name__ = "embed"
    return node


def upsert_node(ctx, corpus):
    def node(state):
        rows = [d for d in corpus.docs if d.get("embedding")]
        # An empty corpus is never a legitimate result, and combined with --wipe
        # it is destructive: Gutenberg answered 504 for Magellan, the fetch
        # failure was swallowed, and the run deleted 312 existing chunks and
        # reported success with zero documents. A transient network error must
        # not be able to empty a corpus and call it a job well done.
        if not rows:
            raise RuntimeError(
                f"refusing to upsert an empty corpus for {ctx.voyage} — "
                f"{len(corpus.raw_texts)} source(s) loaded, {len(corpus.docs)} docs, "
                f"0 embedded. Existing rows left untouched. Check the rejections "
                f"above for a failed fetch before re-running with --wipe.")

        # Wikipedia surviving is not the corpus surviving. extract.py quotes
        # only from public-domain text, so a voyage whose journal failed to
        # fetch while its encyclopaedia articles came through looks healthy —
        # 353 chunks for Magellan, not one of them Pigafetta — and then yields
        # an itinerary with nothing to quote. The primary source is the point;
        # the rest is context.
        pd_text = [d for d in rows
                   if d.get("type") == "text"
                   and str(d.get("license", "")).strip().lower() == "public domain"]
        if not pd_text:
            raise RuntimeError(
                f"refusing to upsert a corpus for {ctx.voyage} with no "
                f"public-domain text: {len(rows)} docs embedded, all of them "
                f"CC or images. The primary source did not arrive — see the "
                f"rejections above. Existing rows left untouched.")
        conn = psycopg2.connect(
            host=ctx.pg_host, port=ctx.pg_port, dbname=ctx.pg_db,
            user=ctx.pg_user, password=ctx.pg_pass)
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                if ctx.wipe:
                    cur.execute("DELETE FROM rag_docs WHERE voyage_slug = %s", (ctx.voyage,))
                    wiped = cur.rowcount
                    state = state.with_decision(Decision(
                        f"Wiped {wiped} existing rows for {ctx.voyage} (full re-embed)", _now()))
                execute_values(cur, """
                    INSERT INTO rag_docs
                      (voyage_slug, type, title, content, source_url, license,
                       credit, media_url, chunk_index, embedding)
                    VALUES %s
                """, [(
                    d["voyage_slug"], d["type"], d["title"], d["content"],
                    d["source_url"], d["license"], d["credit"], d["media_url"],
                    d["chunk_index"], d["embedding"],
                ) for d in rows])
            conn.commit()
        finally:
            conn.close()
        state = state.with_fact(Fact("upserted", len(rows), "upsert", _now()))
        state = state.with_decision(Decision(
            f"Upserted {len(rows)} vectors into pgvector for {ctx.voyage}", _now()))
        return state
    node.__name__ = "upsert"
    return node


def build_nodes(ctx, corpus):
    return [
        load_sources_node(ctx, corpus),
        chunk_node(ctx, corpus),
        embed_node(ctx, corpus),
        upsert_node(ctx, corpus),
    ]


# ---------------------------------------------------------------- discovery nodes
def discover_node(ctx, corpus):
    """Oculus: harvest on-whitelist candidate sources for the subject."""
    def node(state):
        d = oculus.discover(ctx.subject, ctx.lang)
        corpus.candidates = d["candidates"]
        corpus.image_terms = d.get("image_terms", [ctx.subject])
        state = state.with_fact(Fact("candidates", len(corpus.candidates), "discover", _now()))
        return state.with_decision(Decision(
            f"Oculus found {len(corpus.candidates)} on-whitelist candidates for '{ctx.subject}'", _now()))
    node.__name__ = "discover"
    return node


def curate_node(ctx, corpus):
    """Curator agent (LLM): keep sources about the subject, drop the noise."""
    def node(state):
        verdicts = curate.judge(ctx.subject, corpus.candidates)
        kept = []
        for c in corpus.candidates:
            v = verdicts.get(c["id"], {"keep": False, "score": 0, "reason": "no verdict"})
            if v["keep"]:
                kept.append(c)
            else:
                state = state.with_rejection(Rejection(
                    f"source: {c['title'][:56]}",
                    f"curator dropped (score {v.get('score')}): {v['reason'][:70]}", _now()))
        corpus.kept = kept
        state = state.with_fact(Fact("curated_kept", len(kept), "curate", _now()))
        return state.with_decision(Decision(
            f"Curator ({ctx.curator_model}) kept {len(kept)}/{len(corpus.candidates)} sources", _now()))
    node.__name__ = "curate"
    return node


def fetch_node(ctx, corpus):
    """Fetch the curator-approved texts + Commons images."""
    def node(state):
        n = 0
        for c in corpus.kept:
            try:
                if c["kind"] == "gutenberg":
                    body = F.fetch_gutenberg(c["url"])
                else:
                    body = F.fetch_wikipedia(c["lang"], c["title"])
                corpus.raw_texts.append((c["title"], c["source_url"], body, c["license"]))
                n += 1
            except Exception as e:
                state = state.with_rejection(Rejection(
                    f"fetch: {c['title'][:50]}", str(e)[:100], _now()))
        n_img = 0
        for term in corpus.image_terms:
            try:
                imgs = F.commons_images(term, IMAGES_PER_QUERY)
            except Exception:
                imgs = []
            for im in imgs:
                if not im["img"]:
                    continue
                title_clean = re.sub(r"^File:|\.[A-Za-z]+$", "", im["title"]).strip()
                content = (title_clean + ". " + (im.get("desc") or "")).strip()[:1500]
                corpus.docs.append({
                    "voyage_slug": ctx.voyage, "type": "image", "title": im["title"],
                    "content": content, "source_url": im["page"], "license": im["license"],
                    "credit": im["credit"] or None, "media_url": im["img"], "chunk_index": None})
                n_img += 1
        state = state.with_fact(Fact("fetched_texts", n, "fetch", _now()))
        state = state.with_fact(Fact("image_docs", n_img, "fetch", _now()))
        return state.with_decision(Decision(f"Fetched {n} texts + {n_img} images", _now()))
    node.__name__ = "fetch"
    return node


def build_discovery_nodes(ctx, corpus):
    return [
        discover_node(ctx, corpus),
        curate_node(ctx, corpus),
        fetch_node(ctx, corpus),
        chunk_node(ctx, corpus),
        embed_node(ctx, corpus),
        upsert_node(ctx, corpus),
    ]
