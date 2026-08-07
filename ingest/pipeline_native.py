"""The Terraveler ingestion pipelines as native Motus graphs.

Two graphs that share a tail:

    ingestion:  load_sources ─────────────────────────────────▶ chunk → embed → upsert
    discovery:  discover → curate → fetch → codex_restore → codex_bind ─▶ (the same three)

The predecessor passed a `Corpus` object to every node and the payload rode
it — whole Gutenberg bodies, the chunks cut from them, the vectors. That side
channel is what `node-protocol.md` §1.2 forbids, and Motus offers nowhere to
put working memory: everything in `State` becomes trace, and this payload runs
to 4.9 MB in 6,721 chunks for a voyage like cortes-1519.

**Why the stages were not merged instead**, which was the answer in the chat
graph: node-protocol §7.2 — *an attempt that raised commits nothing*. Fuse
load → chunk → embed → upsert into one node, let the embedding service fail
halfway, and every licence-gate rejection recorded earlier is structurally
erased from the trace. Separate nodes mean a node that finishes hands in what
it found. That property is worth a round trip through Postgres, so the payload
lives in `ingest_staging` (see `staging.py`) and only counts and decisions
cross a node boundary.

**Every drop is auditable** — the promise `AGENTS.md` makes for this pipeline —
and it is kept by writing each drop into the state as a Rejection carrying its
reason, not by the shape of the graph.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from dataclasses import dataclass
from typing import Any

from psycopg2.extras import execute_values

from vitruvyan_motus import (
    Decision, EffectDescriptor, Fact, GraphSpec, Rejection, State,
)
from vitruvyan_motus.effects import EffectClass

import fetch as F
import oculus
import curate
import whitelist as W
import staging
import codex as CX
from sources import VOYAGE_SOURCES, IMAGES_PER_QUERY

BATCH = 32
RECORDED = EffectClass.RECORDED_EFFECT
EXTERNAL = EffectClass.EXTERNAL_EFFECT

# The three closing nodes are declared identically in both graphs; naming the
# shape once keeps the two specs from drifting apart.
_TAIL_NODES = [
    {"name": "chunk", "effect_class": "recorded_effect"},
    {"name": "embed", "effect_class": "recorded_effect"},
    # upsert is the only node in either graph that changes the world outside
    # this run, and the only one that may not be re-run blindly.
    {"name": "upsert", "effect_class": "external_effect"},
]
_TAIL_TRANSITIONS = {
    "chunk": {"kind": "next", "to": "embed"},
    "embed": {"kind": "next", "to": "upsert"},
    "upsert": {"kind": "terminal"},
}

# Codex harvests nothing and judges nothing: it restores structurally, scores
# structural validity, dedupes, and binds editions to works. Its LOGIC is
# deterministic, but it reads and writes the staging table, and `pure` in this
# contract means no I/O at all -- a pure node is re-executed by replay
# verification, which would hit the database.
#
# Both graphs run it, for the same reason: text off the open web is restored
# before it is cut into chunks, whether a curator chose the source or
# sources.py did. Declaring it once means neither graph can lose it quietly.
_CODEX_NODES = [
    {"name": "codex_restore", "effect_class": "recorded_effect"},
    {"name": "codex_bind", "effect_class": "recorded_effect"},
]
_CODEX_TRANSITIONS = {
    "codex_restore": {"kind": "next", "to": "codex_bind"},
    "codex_bind": {"kind": "next", "to": "chunk"},
}

INGESTION_SPEC = GraphSpec.from_dict({
    "schema_version": "1.0.0",
    "name": "terraveler-ingestion",
    "version": "1.0.0",
    "entry": "load_sources",
    "nodes": ([{"name": "load_sources", "effect_class": "recorded_effect"}]
              + _CODEX_NODES + _TAIL_NODES),
    "transitions": {"load_sources": {"kind": "next", "to": "codex_restore"},
                    **_CODEX_TRANSITIONS, **_TAIL_TRANSITIONS},
})

DISCOVERY_SPEC = GraphSpec.from_dict({
    "schema_version": "1.0.0",
    "name": "terraveler-discovery",
    "version": "1.0.0",
    "entry": "discover",
    "nodes": [
        {"name": "discover", "effect_class": "recorded_effect"},
        # The curator judges, so it is its own node and its verdicts are the
        # audit this graph exists to produce.
        {"name": "curate", "effect_class": "recorded_effect"},
        {"name": "fetch", "effect_class": "recorded_effect"},
    ] + _CODEX_NODES + _TAIL_NODES,
    "transitions": {
        "discover": {"kind": "next", "to": "curate"},
        "curate": {"kind": "next", "to": "fetch"},
        "fetch": {"kind": "next", "to": "codex_restore"},
        **_CODEX_TRANSITIONS,
        **_TAIL_TRANSITIONS,
    },
})


@dataclass(frozen=True)
class IngestConfig:
    """Read-only run configuration. Nothing here is ever written by a node."""
    voyage: str
    subject: str = ""
    lang: str = "en"
    curator_model: str = "gpt-4.1-mini"
    policy_name: str = "exploration"
    limit: int = 0
    wipe: bool = False
    embed_url: str = "http://terraveler_embedding:8010"
    pg_host: str = "terraveler_postgres"
    pg_port: int = 5432
    pg_db: str = "terraveler"
    pg_user: str = "terraveler"
    pg_pass: str = ""


def _post_json(url, body, timeout=180):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _retry_call(fn, tries=4, base=1.6):
    for i in range(tries):
        try:
            return fn()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(base ** i)


def _emb_literal(vec):
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


# ------------------------------------------------------------- shared tail

def _tail_nodes(cfg: IngestConfig, run_id: str) -> dict[str, Any]:

    def chunk(state: State, ctx) -> State:
        raw = staging.get(cfg, run_id, staging.RAW)
        now = ctx.now()
        docs = []
        for r in raw:
            for i, piece in enumerate(F.chunk(r["body"])):
                docs.append({
                    "voyage_slug": cfg.voyage, "type": "text", "title": r["title"],
                    "content": piece, "source_url": r["url"], "license": r["license"],
                    "credit": None, "media_url": None, "chunk_index": i,
                    "work_id": r.get("work_id")})
        # Image docs were never chunked -- they arrive whole and ride along.
        images = staging.get(cfg, run_id, staging.IMG)
        docs = docs + images
        capped = bool(cfg.limit) and len(docs) > cfg.limit
        if cfg.limit:
            docs = docs[:cfg.limit]
        staging.put(cfg, run_id, staging.DOC, docs)
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"cut {len(raw)} source(s) into {len(docs)} chunk(s)"))
        return (state
                .with_fact(Fact("total_docs", len(docs), "chunk", now))
                .with_decision(Decision(
                    "chunking", "capped" if capped else "complete", now,
                    reason=f"{len(docs)} chunk(s)"
                           + (f", capped at {cfg.limit}" if capped else ""))))

    def embed(state: State, ctx) -> State:
        """Policy governs per-batch failure: exploration records the rejection
        and carries on; strict raises and the run stops there."""
        docs = staging.get(cfg, run_id, staging.DOC)
        url = cfg.embed_url.rstrip("/") + "/v1/embeddings/batch"
        now = ctx.now()
        vectors: list[str | None] = [None] * len(docs)
        embedded = rejected = calls = 0

        for start in range(0, len(docs), BATCH):
            batch = docs[start:start + BATCH]
            texts = [d["content"] for d in batch]
            try:
                resp = _retry_call(lambda: _post_json(url, {"texts": texts}))
                calls += 1
                if not resp.get("success"):
                    raise RuntimeError(resp.get("error") or "embed returned success=false")
                vecs = resp["embeddings"]
                if len(vecs) != len(batch):
                    raise RuntimeError(f"count mismatch {len(vecs)} != {len(batch)}")
                for offset, v in enumerate(vecs):
                    vectors[start + offset] = _emb_literal(v)
                embedded += len(batch)
            except Exception as exc:
                rejected += len(batch)
                state = state.with_rejection(Rejection(
                    f"embed batch [{start}:{start + len(batch)}]",
                    str(exc)[:140], now))
                if cfg.policy_name == "strict":
                    raise

        staging.put(cfg, run_id, staging.DOC, docs, embeddings=vectors)
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"{calls} batch call(s) to {cfg.embed_url}: "
                        f"{embedded} embedded, {rejected} refused"))
        return (state
                .with_fact(Fact("embedded", embedded, "embed", now))
                .with_fact(Fact("rejected", rejected, "embed", now))
                .with_decision(Decision(
                    "embedding", "complete" if not rejected else "partial", now,
                    reason=f"{embedded} embedded, {rejected} rejected "
                           f"(policy={cfg.policy_name})")))

    def upsert(state: State, ctx) -> State:
        rows = [d for d in staging.get(cfg, run_id, staging.DOC) if d.get("embedding")]
        now = ctx.now()

        # An empty corpus is never a legitimate result, and with --wipe it is
        # destructive: Gutenberg answered 504 for Magellan, the failure was
        # swallowed, and the run deleted 312 existing chunks and reported
        # success with zero documents.
        if not rows:
            raise RuntimeError(
                f"refusing to upsert an empty corpus for {cfg.voyage} — 0 embedded. "
                f"Existing rows left untouched. Read the rejections in this trace "
                f"for a failed fetch before re-running with --wipe.")

        # Wikipedia surviving is not the corpus surviving. extract.py quotes
        # only public-domain text, so a voyage whose journal failed while its
        # encyclopaedia articles came through looks healthy — 353 chunks for
        # Magellan, not one of them Pigafetta.
        pd_text = [d for d in rows
                   if d.get("type") == "text"
                   and str(d.get("license", "")).strip().lower() == "public domain"]
        if not pd_text:
            raise RuntimeError(
                f"refusing to upsert a corpus for {cfg.voyage} with no public-domain "
                f"text: {len(rows)} docs embedded, all of them CC or images. The "
                f"primary source did not arrive.")

        conn = staging.connect(cfg)
        wiped = 0
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                if cfg.wipe:
                    cur.execute("delete from rag_docs where voyage_slug = %s", (cfg.voyage,))
                    wiped = cur.rowcount
                execute_values(cur, """
                    insert into rag_docs
                      (voyage_slug, type, title, content, source_url, license,
                       credit, media_url, chunk_index, embedding, work_id)
                    values %s
                """, [(d["voyage_slug"], d["type"], d["title"], d["content"],
                       d["source_url"], d["license"], d["credit"], d["media_url"],
                       d["chunk_index"], d["embedding"], d.get("work_id"))
                      for d in rows])
            conn.commit()
        finally:
            conn.close()

        ctx.record_effect(EffectDescriptor(
            effect_class=EXTERNAL,
            description=f"upserted {len(rows)} row(s) into rag_docs for {cfg.voyage}"
                        + (f", wiping {wiped} first" if cfg.wipe else ""),
            idempotency_key=f"upsert:{cfg.voyage}:{run_id}"))

        if cfg.wipe:
            state = state.with_fact(Fact("wiped", wiped, "upsert", now))
        return (state
                .with_fact(Fact("upserted", len(rows), "upsert", now))
                .with_decision(Decision(
                    "corpus", "promoted", now,
                    reason=f"{len(rows)} vector(s) into pgvector, "
                           f"{len(pd_text)} of them public-domain text")))

    return {"chunk": chunk, "embed": embed, "upsert": upsert}


# ------------------------------------------------------------- shared codex

def _codex_nodes(cfg: IngestConfig, run_id: str) -> dict[str, Any]:
    """The Codex Hunters, shared by both graphs.

    These two nodes were briefly wired into the discovery graph alone, which
    quietly cost the curated path everything they do: normalization, the
    quality gate, dedupe, and the binding of editions to works. Both graphs
    fetch text from the open web and both need it restored before it is cut
    into chunks, so the shape is named once here and neither spec can drop it
    without the other noticing."""
    def codex_restore(state: State, ctx) -> State:
        """Structural repair, a scored quality gate, and dedupe. Harvests
        nothing and judges nothing about a source's subject: the trace records
        what raw looked like, what changed, and every drop with its reason."""
        raw = staging.get(cfg, run_id, staging.RAW)
        now = ctx.now()
        entries, n_invalid, n_flawed = [], 0, 0
        for r in raw:
            raw_hash = CX.sha12(r["body"])
            norm = CX.normalize_text(r["body"])
            norm_hash = CX.sha12(norm)
            state = state.with_decision(Decision(
                "codex_restored", norm_hash, now,
                reason=f"'{r['title'][:50]}' raw sha256:{raw_hash} "
                       f"({len(r['body'])} chars) → normalized ({len(norm)} chars)"))
            errors = CX.quality_errors(norm)
            score = CX.quality_score(errors)
            if score < CX.QUALITY_THRESHOLD_VALID:
                n_invalid += 1
                state = state.with_rejection(Rejection(
                    r["title"], f"codex: INVALID, quality={score:.1f} — "
                                + "; ".join(errors), now))
                continue
            if errors:
                # A text can fail a structural check and still clear the
                # threshold. Recording the failure only when it is fatal is how
                # a Project Gutenberg licence footer sat in the corpus scoring
                # 0.7: detected every run, written down in none of them. A
                # defect the gate saw belongs in the trace whether or not it
                # was enough to drop the source.
                n_flawed += 1
                state = state.with_decision(Decision(
                    "codex_flawed", f"{score:.1f}", now,
                    reason=f"'{r['title'][:50]}' kept despite "
                           + "; ".join(errors)))
            entries.append({"title": r["title"], "url": r["url"], "body": norm,
                            "license": r["license"], "content_hash": norm_hash,
                            "shingles": CX._shingles(norm),
                            "work_override": r.get("work_id")})

        kept, drops = CX._dedupe_texts(entries)
        for desc, reason in drops:
            state = state.with_rejection(Rejection(desc, reason, now))

        survivors = []
        for e in kept:
            dkey = CX.dedupe_key(e["title"], e["url"], e["content_hash"])
            state = state.with_decision(Decision(
                "codex_kept", dkey, now, reason=f"'{e['title'][:50]}'"))
            survivors.append({"title": e["title"], "url": e["url"], "body": e["body"],
                              "license": e["license"], "work_id": e["work_override"]})
        staging.put(cfg, run_id, staging.RAW, survivors)

        # Images never had a body to restore, so they get the one check that
        # applies to them: an exact duplicate of a media_url is a duplicate.
        seen, kept_images, n_img_dropped = set(), [], 0
        for d in staging.get(cfg, run_id, staging.IMG):
            mu = d.get("media_url")
            if mu in seen:
                n_img_dropped += 1
                state = state.with_rejection(Rejection(
                    d.get("title") or mu, f"codex: exact duplicate media_url {mu}", now))
                continue
            seen.add(mu)
            kept_images.append(d)
        staging.put(cfg, run_id, staging.IMG, kept_images)

        n_deduped = (len(entries) - len(kept)) + n_img_dropped
        return (state
                .with_fact(Fact("codex_invalid", n_invalid, "codex_restore", now))
                .with_fact(Fact("codex_flawed", n_flawed, "codex_restore", now))
                .with_fact(Fact("codex_deduped", n_deduped, "codex_restore", now))
                .with_fact(Fact("codex_kept", len(kept), "codex_restore", now))
                .with_decision(Decision(
                    "restoration", "complete", now,
                    reason=f"{len(kept)} kept of {len(raw)} "
                           f"({n_invalid} invalid, {n_flawed} flawed, "
                           f"{n_deduped} deduped)")))

    def codex_bind(state: State, ctx) -> State:
        """Bind each surviving text to its WORK. Two texts landing on one
        work_id under different urls are editions of one work. The title
        heuristic cannot bind cross-language editions, so sources.py may name
        the work explicitly; the override wins verbatim and is recorded, so it
        reads as a decision rather than a coincidence."""
        raw = staging.get(cfg, run_id, staging.RAW)
        now = ctx.now()
        works: dict[str, list] = {}
        bound = []
        for r in raw:
            override = r.get("work_id")
            if override:
                wid = override
                state = state.with_decision(Decision(
                    "codex_work_override", wid, now,
                    reason=f"'{r['title'][:50]}' named its work in sources.py"))
            else:
                wid = CX.work_id_for(r["title"], r["url"])
            works.setdefault(wid, []).append((r["title"], r["url"]))
            bound.append({**r, "work_id": wid})
        staging.put(cfg, run_id, staging.RAW, bound)

        n_multi = 0
        for wid, editions in works.items():
            if len(editions) > 1:
                n_multi += 1
                names = "; ".join(f"{t[:40]} ({u})" for t, u in editions)
                state = state.with_decision(Decision(
                    "codex_edition_of", wid, now,
                    reason=f"{len(editions)} editions — {names}"))
        return (state
                .with_fact(Fact("codex_works", len(works), "codex_bind", now))
                .with_decision(Decision(
                    "binding", "complete", now,
                    reason=f"{len(bound)} text(s) into {len(works)} work(s), "
                           f"{n_multi} multi-edition")))

    return {"codex_restore": codex_restore, "codex_bind": codex_bind}


# --------------------------------------------------------------- ingestion

def make_ingestion_nodes(cfg: IngestConfig, run_id: str) -> dict[str, Any]:

    def load_sources(state: State, ctx) -> State:
        conf = VOYAGE_SOURCES.get(cfg.voyage)
        if not conf:
            raise ValueError(f"unknown voyage: {cfg.voyage}")
        now = ctx.now()
        raw, images, n_txt = [], [], 0

        for s in conf["texts"]:
            if s["kind"] in ("gutenberg", "archive"):
                # The licence gate applied to curated sources, not only to
                # discovered ones: every in-copyright edition proposed so far
                # was a famous book someone had good reason to trust. Trust is
                # not a licence.
                ok, lic = W.verify_source(s["url"])
                if not ok:
                    state = state.with_rejection(Rejection(
                        s.get("title", s["url"]), f"licence gate: {lic}", now))
                    continue
                # A fetch that fails must say so. Swallowed whole, a 504 from
                # Gutenberg produced a run with no sources, no rejections and a
                # cheerful summary — the quietest way to lose a corpus.
                try:
                    body = (F.fetch_gutenberg(s["url"]) if s["kind"] == "gutenberg"
                            else F.fetch_archive_text(s["url"]))
                except Exception as exc:
                    state = state.with_rejection(Rejection(
                        s.get("title", s["url"]),
                        f"FETCH FAILED: {type(exc).__name__}: {str(exc)[:160]}", now))
                    continue
                # The gate's answer is a reason, not a column value. Stored as
                # a reason it becomes unfilterable — see canonical_license().
                label = W.canonical_license(lic)
                state = state.with_decision(Decision(
                    "licence_gate", label, now,
                    reason=f"{s.get('title', s['url'])[:60]} — {lic} → '{label}'"))
                # An optional "work" key names the codex bind explicitly, for
                # the cases its title heuristic cannot reach — chiefly
                # cross-language editions that share no text, only a subject.
                raw.append({"title": s["title"],
                            "url": s.get("source_url", s["url"]),
                            "body": body, "license": label,
                            "work_id": s.get("work")})
                n_txt += 1
            elif s["kind"] == "wikipedia":
                for t in s["titles"]:
                    body = F.fetch_wikipedia(s["lang"], t)
                    url = (f"https://{s['lang']}.wikipedia.org/wiki/"
                           + t.replace(" ", "_"))
                    raw.append({"title": f"Wikipedia — {t}", "url": url,
                                "body": body, "license": s["license"],
                                "work_id": None})
                    n_txt += 1

        n_img = 0
        for q in conf.get("image_queries", []):
            try:
                imgs = F.commons_images(q, IMAGES_PER_QUERY)
            except Exception as exc:
                state = state.with_rejection(Rejection(
                    f"image query '{q}'", f"fetch failed: {str(exc)[:120]}", now))
                imgs = []
            for im in imgs:
                if not im["img"]:
                    continue
                title_clean = re.sub(r"^File:|\.[A-Za-z]+$", "", im["title"]).strip()
                content = (title_clean + ". " + (im.get("desc") or "")).strip()[:1500]
                images.append({
                    "voyage_slug": cfg.voyage, "type": "image", "title": im["title"],
                    "content": content, "source_url": im["page"],
                    "license": im["license"], "credit": im["credit"] or None,
                    "media_url": im["img"], "chunk_index": None, "work_id": None})
                n_img += 1

        staging.put(cfg, run_id, staging.RAW, raw)
        # Images arrive already document-shaped — they never had a body to
        # chunk — so they are staged as docs and `chunk` appends the text
        # chunks beside them.
        staging.put(cfg, run_id, staging.IMG, images)
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"fetched {n_txt} text source(s) and {n_img} image doc(s) "
                        f"for {cfg.voyage}"))
        return (state
                .with_fact(Fact("text_sources", n_txt, "load_sources", now))
                .with_fact(Fact("image_docs", n_img, "load_sources", now))
                .with_decision(Decision(
                    "sources", "loaded" if (n_txt or n_img) else "none", now,
                    reason=f"{n_txt} text source(s) past the licence gate, "
                           f"{n_img} image doc(s)")))

    return {"load_sources": load_sources,
            **_codex_nodes(cfg, run_id), **_tail_nodes(cfg, run_id)}


# --------------------------------------------------------------- discovery

def make_discovery_nodes(cfg: IngestConfig, run_id: str) -> dict[str, Any]:
    subject = cfg.subject or cfg.voyage

    def discover(state: State, ctx) -> State:
        now = ctx.now()
        found = oculus.discover(subject, cfg.lang)
        candidates = found["candidates"]
        # image_terms travel with the candidates: `fetch` needs them, and they
        # are oculus's output, not configuration.
        staging.put(cfg, run_id, staging.RAW,
                    [{"candidate": c} for c in candidates]
                    + [{"image_terms": found.get("image_terms", [subject])}])
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"oculus proposed {len(candidates)} on-whitelist "
                        f"candidate(s) for {subject!r}"))
        return (state
                .with_fact(Fact("candidates", len(candidates), "discover", now))
                .with_decision(Decision(
                    "discovery", "found" if candidates else "empty", now,
                    reason=f"{len(candidates)} on-whitelist candidate(s)")))

    def curate_node(state: State, ctx) -> State:
        """The gate. Every drop is written down with the score that caused it."""
        staged = staging.get(cfg, run_id, staging.RAW)
        candidates = [r["candidate"] for r in staged if "candidate" in r]
        terms = next((r["image_terms"] for r in staged if "image_terms" in r), [subject])
        now = ctx.now()
        verdicts = curate.judge(subject, candidates)
        kept = []
        for c in candidates:
            v = verdicts.get(c["id"], {"keep": False, "score": 0, "reason": "no verdict"})
            if v["keep"]:
                kept.append(c)
            else:
                state = state.with_rejection(Rejection(
                    f"source: {c['title'][:56]}",
                    f"curator dropped (score {v.get('score')}): {v['reason'][:70]}",
                    now, evidence={"url": c.get("url"), "score": v.get("score")}))
        staging.put(cfg, run_id, staging.DOC,
                    [{"candidate": c} for c in kept] + [{"image_terms": terms}])
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"{cfg.curator_model} judged {len(candidates)} candidate(s)"))
        return (state
                .with_fact(Fact("curated_kept", len(kept), "curate", now))
                .with_decision(Decision(
                    "curation", "kept" if kept else "none", now,
                    reason=f"{cfg.curator_model} kept {len(kept)}/{len(candidates)}")))

    def fetch_node(state: State, ctx) -> State:
        staged = staging.get(cfg, run_id, staging.DOC)
        kept = [r["candidate"] for r in staged if "candidate" in r]
        terms = next((r["image_terms"] for r in staged if "image_terms" in r), [subject])
        now = ctx.now()
        raw, images, failed = [], [], 0

        for c in kept:
            try:
                body = (F.fetch_gutenberg(c["url"]) if c["kind"] == "gutenberg"
                        else F.fetch_wikipedia(c["lang"], c["title"]))
            except Exception as exc:
                failed += 1
                state = state.with_rejection(Rejection(
                    f"fetch: {c['title'][:50]}", str(exc)[:100], now))
                continue
            raw.append({"title": c["title"], "url": c["source_url"], "body": body,
                        "license": c["license"], "work_id": None})

        n_img = 0
        for term in terms:
            try:
                imgs = F.commons_images(term, IMAGES_PER_QUERY)
            except Exception:
                imgs = []
            for im in imgs:
                if not im["img"]:
                    continue
                title_clean = re.sub(r"^File:|\.[A-Za-z]+$", "", im["title"]).strip()
                content = (title_clean + ". " + (im.get("desc") or "")).strip()[:1500]
                images.append({
                    "voyage_slug": cfg.voyage, "type": "image", "title": im["title"],
                    "content": content, "source_url": im["page"],
                    "license": im["license"], "credit": im["credit"] or None,
                    "media_url": im["img"], "chunk_index": None, "work_id": None})
                n_img += 1

        staging.put(cfg, run_id, staging.RAW, raw)
        staging.put(cfg, run_id, staging.IMG, images)
        ctx.record_effect(EffectDescriptor(
            effect_class=RECORDED,
            description=f"fetched {len(raw)} of {len(kept)} curated source(s) "
                        f"and {n_img} image(s)"))
        return (state
                .with_fact(Fact("fetched_texts", len(raw), "fetch", now))
                .with_fact(Fact("image_docs", n_img, "fetch", now))
                .with_decision(Decision(
                    "fetching", "complete" if not failed else "partial", now,
                    reason=f"{len(raw)} text(s) and {n_img} image(s), {failed} failed")))


    return {"discover": discover, "curate": curate_node, "fetch": fetch_node,
            **_codex_nodes(cfg, run_id), **_tail_nodes(cfg, run_id)}
