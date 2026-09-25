"""Reducing raw HTML to the text a reader would actually see.

Built for two different jobs that turned out to need the same machine:

  - `ingest/fetch.py::_wikisource_render_to_text` needs this to make a
    Wikisource *work* page readable at all — `prop=extracts` never follows
    the `<pages index=... />` transclusion those pages are built from, so
    the only way to get the real chapter text is to render the page
    (`action=parse&prop=text`) and clean up the HTML that comes back.

  - `ingest/verbatim.py::source_text` needs it for a different reason: a
    quotation can only be checked against what a reader would see, and
    Wikipedia/Wikisource — the atlas's two largest live sources — are
    served as `text/html` with no plain-text alternative. Refusing every
    HTML source outright, the previous rule, rejected genuine, verbatim
    citations from those sources for no reason but the Content-Type
    header (see submission #101: a real, hand-verified Verrazzano
    quotation from a Wikisource chapter, refused only because the page
    arrived as HTML).

Because the second job is a SAFETY check, not just a readability pass, it
demands more than the first one ever needed: a scan and a transcription of
it differ, and matching is deliberately generous about that (see
`verbatim.py`'s module docstring) — but a phrase hidden in a `<script>`, a
`<template>`, an HTML comment, or an element switched off with `hidden`,
`aria-hidden="true"`, `display:none` or `visibility:hidden` is not "on the
page" in the sense Carta 3.4 means at all. None of those is a rendering
quirk to be generous about; all four are exactly the "text present but
never readable" case the original refusal existed to prevent — an external
review demonstrated five concrete bypasses against a naive `<[^>]+>`
regex stripper (see `visible_text()` below for how each is closed).

Deliberately NOT a general-purpose HTML-to-text converter. Anything this
cannot classify with confidence is left in the output — because leaving in
text that turns out to be visible costs nothing (locate_in_source still has
to find the exact quoted span; extra unrelated haystack text does not make
an unrelated quotation match), while dropping text that turns out to be
visible costs a genuine citation its verification. The three hiding
signals below are the only ones checked for exactly this reason: they are
the ones an inline read of the element's own attributes can decide without
guessing. Guessing beyond them is refused, in the same spirit as
`_division_is_unambiguous` in verbatim.py refusing to guess which hyphen is
the margin's.

DECLARED LIMIT, not a silently accepted one: this does not execute CSS or
JavaScript. Hiding achieved INDIRECTLY — a stylesheet rule that targets a
class by selector, a script that sets `.hidden` at runtime, a
`<link rel="stylesheet">` pulling in the rule that actually hides the
element — is invisible to an inline-attribute check and will NOT be
detected. Public MediaWiki output (Wikipedia, Wikisource, the only HTML
sources this project fetches today) does not rely on that technique for
its real content. If `visible_text()` is ever pointed at a source that
does, this gap is real and unresolved, not patched over by this comment.
"""
from __future__ import annotations

import html
import re

# Elements that render nothing at all, ever, and whose closing tag may be
# entirely absent from the input — HTML5 treats an unterminated <script> as
# consuming everything after it as script data up to the next literal
# "</script>" or end of input, which is NOT a parse error. A stripper that
# requires seeing a closing tag to remove a block leaves that "orphaned"
# tail sitting in the output as though it were prose — this was bypass #1
# in the review that killed the previous regex-only approach. <template> is
# included alongside script/style for the same reason: its content is
# parsed but never part of the rendered document a reader sees.
_INERT_CONTAINERS = frozenset({"script", "style", "template"})

# Void elements: no content, no closing tag to wait for.
_VOID_ELEMENTS = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
})

# Closing tags that read as a paragraph boundary once the markup they were
# wrapping is gone — kept purely for readability of the emitted text, not
# for safety.
_BLOCK_CLOSE = frozenset(
    {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table"})

# Comments FIRST, and as their own whole-match pass, before anything else
# touches the string. `<!-- > QUOTE -->` is a well-formed comment — its
# content happens to contain a bare '>' — but a tag-stripper applied before
# comments are removed reads the '>' right after "<!--" as the END of a
# "tag" `<!-- >`, leaving " QUOTE -->" behind as literal text. That was
# bypass #4. A proper `<!--.*?-->` match (DOTALL, non-greedy) always
# consumes to the real `-->`, never to an incidental '>' inside the comment.
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)

# A '<' only starts markup if what follows looks like a tag name, a closing
# tag, a comment/doctype ('!'), or a processing instruction ('?') — the same
# lookahead a real HTML parser uses. Without it, a literal '<' inside
# genuine prose (e.g. "3 < 4 dinars") would be mistaken for the start of a
# tag and everything up to the next '>' would vanish from the output —
# exactly the OCR-bracket regression `verbatim.py`'s own module docstring
# warns about, just relocated into this function instead of fixed.
_TAG_START_RE = re.compile(r"[a-zA-Z!/?]")

_TAG_NAME_RE = re.compile(r"^/?\s*([a-zA-Z][a-zA-Z0-9:-]*)")

_ATTR_RE = re.compile(
    r'([a-zA-Z_:][-a-zA-Z0-9_:.]*)'
    r'''(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?'''
)

_HIDDEN_STYLE_RE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.I)


def _scan_tag_end(s: str, i: int) -> int:
    """`s[i] == '<'`. Returns the index just past this tag's matching '>',
    treating a '>' inside a quoted attribute value as data rather than the
    tag's end — `<div data-x=">QUOTE">visible</div>` is one element with a
    weird attribute, not a truncated tag followed by literal text "QUOTE".
    A plain `<[^>]+>` regex gets this wrong (bypass #5 in the review);
    tracking quote state while scanning does not.

    Returns len(s) if no unquoted '>' is ever found — an unterminated tag
    consumes the rest of the input rather than letting whatever follows a
    runaway quote leak out as though it were page text."""
    n = len(s)
    j = i + 1
    quote = None
    while j < n:
        c = s[j]
        if quote:
            if c == quote:
                quote = None
        elif c in ("'", '"'):
            quote = c
        elif c == ">":
            return j + 1
        j += 1
    return n


def _tag_name(body: str) -> str:
    m = _TAG_NAME_RE.match(body)
    return m.group(1).lower() if m else ""


def _tag_attrs(body: str) -> dict:
    """Best-effort attribute map for one tag's interior. Not a validator —
    it only has to notice the three hiding signals `_is_hidden_tag` checks
    for; anything this cannot confidently parse is simply absent from the
    result, which lands on the same side as the module docstring's rule:
    an attribute this cannot read cannot be trusted to say "hidden"
    either."""
    out: dict = {}
    start = 1 if body[:1] == "/" else 0
    for m in _ATTR_RE.finditer(body, start):
        name = m.group(1).lower()
        value = m.group(2)
        if value is None:
            value = m.group(3)
        if value is None:
            value = m.group(4)
        out[name] = value if value is not None else ""
    return out


def _is_hidden_tag(attrs: dict) -> bool:
    """The three EXPLICIT signals this checks for, and only these — see the
    module docstring for why guessing beyond them is refused rather than
    attempted."""
    if "hidden" in attrs:
        return True
    if attrs.get("aria-hidden", "").strip().lower() == "true":
        return True
    style = attrs.get("style", "")
    return bool(style) and bool(_HIDDEN_STYLE_RE.search(style))


def visible_text(raw_html: str) -> str:
    """The text a reader's browser would show for `raw_html`: markup gone,
    HTML comments gone, and any element carrying an explicit hiding signal
    gone along with everything inside it. See the module docstring for
    exactly what "explicit" covers, and its declared limit.

    A single left-to-right pass over the string, tracking a stack of open
    elements and how many of them are currently hiding — so a hidden
    container's content is removed as a whole even when it nests another
    element of the SAME tag name inside it
    (`<div hidden>...<div>...</div>...</div>`), which a non-nesting regex
    match would only remove up to the FIRST inner closing tag and leak the
    remainder as though it were visible."""
    if not raw_html:
        return ""
    src = _COMMENT_RE.sub("", raw_html)
    n = len(src)
    out: list[str] = []
    stack: list[tuple[str, bool]] = []  # (tag name, is this one hiding)
    hidden_depth = 0
    i = 0
    while i < n:
        ch = src[i]
        if ch == "<" and i + 1 < n and _TAG_START_RE.match(src[i + 1]):
            end = _scan_tag_end(src, i)
            closed = end <= n and src[end - 1:end] == ">"
            body = src[i + 1:end - 1] if closed else src[i + 1:end]
            is_close = body.startswith("/")
            name = _tag_name(body)

            if name in _INERT_CONTAINERS and not is_close:
                closer = re.compile(r"</\s*" + name + r"\s*>", re.I)
                m = closer.search(src, end)
                i = m.end() if m else n
                continue

            self_closing = body.rstrip().endswith("/")
            if not is_close and name and name not in _VOID_ELEMENTS and not self_closing:
                hiding = _is_hidden_tag(_tag_attrs(body))
                stack.append((name, hiding))
                if hiding:
                    hidden_depth += 1
            elif is_close and name:
                for k in range(len(stack) - 1, -1, -1):
                    if stack[k][0] == name:
                        popped = stack[k:]
                        del stack[k:]
                        hidden_depth -= sum(1 for _, h in popped if h)
                        break

            if hidden_depth == 0:
                if name in _BLOCK_CLOSE and is_close:
                    out.append("\n\n")
                elif name == "br" and not is_close:
                    out.append("\n")
            i = end
            continue
        j = src.find("<", i + 1)
        if j == -1:
            j = n
        if hidden_depth == 0:
            out.append(src[i:j])
        i = j

    text = "".join(out)
    text = html.unescape(text)
    text = text.replace("​", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]*(\n[ \t]*)+", "\n\n", text)
    return text.strip()
