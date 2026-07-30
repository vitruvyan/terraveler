---
name: terraveler-design
description: The visual law of Terraveler — the three typefaces and five voices, the token layer, spacing, radii, colour and page structure. Load BEFORE writing or changing any page, component, JSX or CSS in this repo, and before choosing a font, size, colour, radius, shadow or spacing value. Triggers on: new page or route, new component, editing app/globals.css, styling anything, "make it look better", hero, panel, card, button, badge, log, table, dark/space theme, responsive work, design review.
---

# The visual law of Terraveler

Terraveler is a document, not an app. It reads as a printed atlas that happens
to be on a screen — a nobilitated document: the ornament budget is spent on
typography, rules and white space, never on effects. No gradients, no
glassmorphism, no glow, no long shadows, no decorative animation.

## The one law

**The division is not atlas versus desk. It is who is speaking.**

A page is not styled by which section it lives in. Every surface mixes voices,
and the mix is what changes: the atlas narrates and the machine annotates in
the margin; the desk is mostly machine with human reasoning inside it. Same
paper, same rules, same grid, same scale — different proportion of machine.

This is why the editorial desk must never be reskinned as "the modern part".
It is the same publishing house, in the room where the telegraph is.

## Where the truth lives — do not copy it into this file

| What | Where | Note |
|---|---|---|
| Every token (colour, type scale, space, radii, rules, elevation, measure, motion) | `:root` in `app/globals.css` | The SSOT. Values drift; read them, never restate them. |
| The type system, with real content | `/specimen` → `app/specimen/` | Both registers side by side. Look before you argue. |
| The palette, with every contrast ratio | `/specimen/palette` | **Measures itself** from the computed tokens. If you change a colour, this page will tell you what you did to it. |
| The wordmark and the icon set | `/specimen/mark` | Candidates at real header size, and every icon beside the emoji it replaced. |
| How an image is presented | `/specimen/plates` | The five fields a plate must carry, its mount, and where it may sit. |
| The three families | `app/layout.tsx` | Loaded via `next/font/local`, self-hosted, OFL. |

The four specimen chapters sit **behind the editor session**
(`app/specimen/layout.tsx`) and are linked from the desk's own tab row. They
are working documents about the site, not pages of the atlas: noindex was not
enough, since they carry notes on what is wrong with the stylesheet. The gate
is **open on a dev server** — a page whose purpose is to be looked at while you
edit CSS is useless if it needs a session to load — and closed wherever
`NODE_ENV` is `production`.

If a value you need is not in `:root`, **add a token** — do not inline the
number. That is how the twenty-odd hardcoded sizes below get retired instead of
multiplied.

## The five voices

| # | Voice | Token | Used for |
|---|---|---|---|
| 1 | **The cartouche** | `--font-display` (Cormorant Garamond) | Page titles, voyage names, wordmark, the figures that matter. **Display sizes only.** |
| 2 | **The narrator & the traveller** | `--font-body` (EB Garamond) | Narration; and in *italic*, larger, behind a brass rule, the verbatim quotations. |
| 3 | **The machine** | `--font-mono` (IBM Plex Mono) | Logs, AXIS traces, verdicts, timestamps, coordinates, identifiers, confidence, attributions, source credits. |
| 4 | **The institution** | `--font-ui` (EB Garamond) | Buttons, nav, tabs, chips, panel titles, table headers, labels. |
| 5 | **The margin** | `--font-mono`, `--step--2`, `--ink-soft` | Marginalia, provenance, stage numbers, the hand annotating the edge. |

Voice 3 is not "the tech font". It is the typewriter and the telegraph — the
moment the ship's log stopped being handwritten. That is why the Voyager 2
`.space` theme reads in it: a probe's log is telemetry.

## Golden rules — the filter on every diff

If a change breaks one of these, stop and reconsider rather than add an
exception.

- **`--font-display` is for display sizes only.** Cormorant is cut for large
  type and goes spindly below roughly 20px. Anything smaller that needs
  authority takes `--font-ui`. Georgia forgave being used at every size; this
  face does not. *(This one rule accounted for 31 of the 38 display usages in
  the file when the system landed.)*

- **Chrome that states a fact is the machine speaking.** Coordinates, dates,
  identifiers, versions, verdicts, attributions, credits, confidence: mono,
  `font-variant-numeric: tabular-nums lining-nums`. This also solves
  legibility — Garamond at 10px is weak where Plex Mono is not.

- **An identifier stays machine voice inside human prose.** `v0.4`,
  `carta_version 0.2`, `lib/carta.ts`, `list_gaps` get `--font-mono` even in
  the middle of a narrated paragraph. Without it, Garamond's oldstyle figures
  render `v0.4` with a short zero that reads as the letter *o*. Already handled
  for `.prose code`; do it by hand elsewhere.

- **Reasoning is prose, records are data.** In any log or verdict, the *why* a
  human wrote is serif at reading size; the *record* around it is mono. If both
  look the same, the reader cannot tell which one to read.

- **Paper does not have rounded corners.** `--radius-1`/`--radius-2`/
  `--radius-pill`, and the largest real radius is 3px. Above ~6px a rectangle
  stops reading as a cut sheet and starts reading as a widget.

- **Paper is flat.** `--elev-0` by default. `--elev-1` only for things that
  genuinely float above the page — lightbox, dropdown, floating panel. Cards,
  tiles and panels do not cast shadows.

- **Hierarchy encodes meaning, not layout convenience.** A number that demands
  an action and a number that is history must not have the same visual weight.
  Nine identical tiles is a form, not a dashboard.

- **Colour has four layers, and the layer decides what a colour may do.**
  *Substrate* (`--parchment*`) never carries text. *Ink* (`--ink`,
  `--ink-soft`, `--ink-faint`) is what is written. *Mark* — `--brass` makes
  marks (rules, borders, dots) and **never carries a word**; `--brass-text` is
  the same hue at AA for the words. *State* (`--state-*`) is where a
  submission stands. Plus the accent ramps and the map-only `--route`.

- **Anything carrying text clears 4.5:1, at every size.** Not 3:1 because
  "it's large" — on this site that text is nearly always 10 or 11px. Check on
  `/specimen/palette`, which measures rather than claims.

- **Every theme re-declares every layer.** A token that passes on parchment
  fails on a starfield. Inheriting colour onto a different ground is the
  fastest way to break contrast without noticing — it is exactly how
  `--state-changes` shipped at 3.29:1 inside `.space` and got caught.

- **Never a raw hex in a component.** If a colour is missing, add a token.

- **Icons are drawn, never emoji.** Use `components/Icon.tsx`. An emoji is
  rendered by Apple or Google or Microsoft depending on who is looking, so the
  mark of the atlas would not be ours and not the same twice — and they arrive
  full of cartoon colour on a page whose whole argument is ink on parchment.
  New icons: 24×24 box, stroke only in `currentColor`, weight 1.3, no fill, no
  two-tone. **Test it at 16–18px**, which is where it lives; a drawing that
  only works at 48 is not finished. Three of the first sixteen had to be
  redrawn for exactly that reason.

- **A plate carries five fields or it does not publish.** `url`, `caption`,
  `credit`, `license`, `source_url` — four of the five are provenance, which is
  the same discipline the Carta puts on a quotation. The caption is the
  narrator and is serif; credit, licence and source are the machine and are
  mono. Mount it with a paper margin and a hairline: no rounded corner, no
  shadow, no card. The lightbox is the one place a plate may float, and the
  only sanctioned use of `--elev-1`.

- **Ornament is a printer's, not a decorator's.** `components/Ornament.tsx`
  holds a lozenge-and-swash break, a fleuron, a tail and a corner — the sober
  end of what the reference sheets offer, because florid corner-pieces on a
  page of measured contrast ratios undo the argument the rest of the site
  makes. They are marks, so they take `--brass` and are `aria-hidden`.

- **One dropped initial per chapter, never two on a page.** `.dropcap` on the
  opening paragraph; it says "the argument starts here", and a second one says
  nothing. It reverts to plain text below 640px, where the measure is too
  narrow for three lines beside a letter.

- **A token nobody uses gets deleted.** `--sea` was declared in two themes and
  used nowhere in the repo; a dead token is worse than a missing one, because
  the next person takes it for real.

- **Repetition is a content-design problem before it is a CSS one.** Four
  identical log entries collapse into one with a count, they do not get
  restyled.

- **Reuse the shell before inventing one.** `TitlePage` (frontispiece + mounted
  plate), `SiteHeader`, `SiteFooter` already carry the editorial language. A
  new page that reinvents an opening is an error, not a feature.

- **A page opens as a frontispiece, not as a poster.** Eyebrow, cartouche, dek,
  a printer's break, the actions — on paper. The map goes below it, *mounted*,
  where it can be looked at and where it carries its five fields. Four pages
  used to open with the same darkened full-bleed photograph and you could not
  tell them apart; the treatment erased what made each engraving different, and
  none of the four could be read. `EditorialPage` still exists for anything
  that genuinely wants a photographic band, but the default is the frontispiece.

- **A mount hugs its plate.** These images run from near-square to wide, so a
  fixed-width mount strands a portrait plate in a field of parchment — which is
  what a passe-partout exists to prevent. Size the mount to the image, not the
  image to the mount.

## Before you add a surface

1. Read `:root` in `app/globals.css` for the tokens that exist now.
2. Open `/specimen` if the surface is editorial or a log.
3. Ask **who speaks in each part of it**, and assign voices before sizes.
4. Reuse `EditorialPage` / existing primitives; extend rather than duplicate.
5. Use tokens. A literal `px` or hex in new code needs a reason in the diff.

## Known debt — the sweep is NOT finished

The token layer is **declared, not yet enforced**. Do not assume a surface you
are editing is already migrated; check it. As of the typography commit:

- **25 distinct hardcoded `font-size` values** remain in `globals.css`
  (13px, 12.5px, 11px, 12px, 11.5px, 14px, 13.5px, 10.5px…). They come out
  surface by surface, mapped onto `--step-*`.
- **15 distinct hardcoded `border-radius` values** remain. Same treatment.
- `--rule-*` and `--elev-*` have **zero** usages so far — the hairlines and
  shadows in the file are still ad hoc.
- **~300 colour literals** remain in `globals.css`. A good share are the token
  declarations themselves and alpha overlays doing real work; the rest want
  tokenising. Note the `rgba(255,255,255,0.x)` lifts are **not** all the same
  thing — over the map their translucency is load-bearing and must not be
  flattened to `--parchment-raised` without looking.
- **`--parchment-raised` has one use** (`.acct-note`). The rest of the raised
  panels are pending case-by-case migration, per the point above.
- Raw hexes remain in a handful of components — `opengraph-image.tsx`,
  `AuthBackdrop.tsx`, `icon.tsx`, `VoyageExperience.tsx`, `SolarSystemMap.tsx`,
  `SolarSystem3D.tsx`, `ContributePanel.tsx`. Some are OG/icon rendering where
  a token cannot reach; the rest are ordinary debt.
- The **Quarterdeck overview is done** and is the reference for how a surface
  looks on this system — see `components/desk/Quarterdeck.tsx`, the first
  thing here built with no literal size, radius or colour. Its **submissions
  and crew tabs are not**: they are still inline styles and raw px.
- Other surfaces still off the system: the map chrome beyond the notes already
  moved, `/account/agents`, the contribute panel, `/crew` and `/connect` (which
  never had an opening at all).
- The **paper grain** is on `.tp-page` and on the specimen, and nowhere else.
  Extending it to the rest of the site is a decision nobody has taken.
- **Emoji survive in `SpaceVoyageExperience.tsx`** (📡📊🖼🪐💽📜☰👤) and in the
  **map waypoint markers**. The Earth atlas, the site header and the search are
  done; the Voyager theme and the markers are not.
- The **wordmark is settled**: engraved small caps, Cormorant 500, +0.2em, via
  the shared `.wordmark` class. Page titles are already Cormorant light in
  roman, so a roman wordmark would have stopped being a mark and become one
  more heading; and the wide tracking this file always asked of it is wrong in
  roman and obligatory in small caps.

When you retire a piece of this debt, **update this list in the same commit**.
A stale debt list is worse than none: it tells the next agent the sweep is done
when it is not.

## Two traps that have already cost time

**A surface behind a session cannot be looked at.** The desk needs a real
login, so a change to it is unverifiable before it ships — unless the markup
lives in components that something else can render with fixture data. That is
why `components/desk/Quarterdeck.tsx` exists and why `/specimen` feeds it the
real July 2026 log rows. Build any gated surface this way: same components,
fixtures in the specimen. Do not go looking in `.env` for credentials.

**The webfonts are subset, so an OpenType feature you did not ask for is not
there.** `font-variant-numeric: lining-nums` silently did nothing until `lnum`
was added to the subsetting command, and the Quarterdeck's figures rendered
`O I I` instead of `0 1 1` — Cormorant's oldstyle zero reads as a letter. The
cut in `app/fonts/` currently carries `kern, liga, calt, onum, lnum, tnum,
pnum, smcp, c2sc, dlig, frac`. If you need a feature outside that list, the
fonts must be re-subset; asking for it in CSS will fail quietly.

## Checking your work

Type decisions are made with eyes, not adjectives. Build and look:

```
npm run dev            # then screenshot the surface you changed
npm run build          # never while dev is running — it wipes .next under it
```

Check both a wide viewport and ~390px. Wide content (tables, logs, code) scrolls
inside its own container; the page body never scrolls horizontally.
