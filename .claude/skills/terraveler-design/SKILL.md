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

- **A record is not a question.** Where someone has to decide something, show
  what is being decided — derived from the data, never written beside it — and
  keep the raw record below it and shut. The desk asked for verdicts on
  submissions by printing the JSON payload: a faithful record, and a poor thing
  to ask a verdict from. `components/desk/SubmissionBrief.tsx` is the pattern.
  A zero is a finding and gets said out loud ("no stage carries a quotation"),
  never left as an empty cell.

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

- **A layer a theme cannot re-declare is not a layer.** If adding a theme
  means copying a list of overrides by hand, the token is missing, not the
  discipline. `.space` carried a block of nine re-declared instrument
  backgrounds with a comment explaining that the shared rules baked the
  parchment RGB in directly — so the third atlas was born broken, because
  nobody knew to copy the list. `--paper-rgb` retired all nine. Before writing
  a `.theme .thing { background: … }` override, ask what token is missing.

- **A register belongs to its subject, not to the machinery that draws it.**
  Terraveler had three atlases and two registers because the split ran along
  the renderer — orrery versus MapLibre — so a Moon traverse inherited
  Age-of-Sail parchment by accident of sharing a map component. Theme on
  `body`, `kind`, evidence: something the reader can see. Never on which code
  path drew it.

- **One register per family, and let the subject supply its own colour.** The
  temptation with Worlds was a theme per body — Mars red, lunar grey. That
  over-fits: today the family is one voyage. One register carries the family,
  a single token is keyed to the body, and the body's real colour arrives
  through the map tiles, where it is true rather than asserted.

- **Measure the ground before choosing ink for it.** Worlds was drawn first as
  dark basalt, on the reasonable assumption that everything past Earth is
  dark. The lunar basemap renders at **151/255** — the Moon is a pale body,
  and the register was fighting its own map. One screenshot and one average
  settled what taste had got backwards.

- **Never a raw hex in a component.** If a colour is missing, add a token.

- **Icons are drawn, never emoji.** Use `components/Icon.tsx`. An emoji is
  rendered by Apple or Google or Microsoft depending on who is looking, so the
  mark of the atlas would not be ours and not the same twice — and they arrive
  full of cartoon colour on a page whose whole argument is ink on parchment.
  New icons: 24×24 box, `currentColor`, weight 1.3, no two-tone. **Test it at
  16–18px**, which is where it lives; a drawing that only works at 48 is not
  finished. Three of the first sixteen had to be redrawn for exactly that
  reason.

  Stroke is the default and the morion is the one exception — it is real
  artwork, filled rather than stroked, kept in `art/` and rebased into the box.
  It is allowed because its own bands measure ~1.4 units, the weight everything
  else is stroked at: the exception is in how it is expressed, not in how it
  looks. It also **declares a floor of 22px**, because a double outline cannot
  survive 16. An icon may raise its floor; it may not quietly ship below one,
  and the specimen renders it at its floor rather than at 18 — showing an icon
  below the size it works at is a rigged test.

- **A plate carries six fields or it does not publish.** `url`, `caption`,
  `credit`, `license`, `source_url`, `date` — five of the six are provenance,
  which is the same discipline the Carta puts on a quotation. The caption is
  the narrator and is serif; credit, licence, source and date are the machine
  and are mono. Mount it with a paper margin and a hairline: no rounded corner,
  no shadow, no card. The lightbox is the one place a plate may float, and the
  only sanctioned use of `--elev-1`.

  **`date` is when the IMAGE was made, and it is required.** It is almost never
  the date of the stage it illustrates: Hodges drew Cape Town in 1787 and the
  Boudeuse moored there in 1769, and the one photogenic view of Port Praslin
  turns out to be from Duperrey's voyage fifty-five years later. A picture set
  beside a dated stage asserts they share that date unless the page says
  otherwise — so the page says otherwise, and the submission gate refuses a
  plate that will not say. `rights_note` is optional and holds the holding
  institution's own terms where they differ from the work's licence; it is
  prose a human wrote, so it stays in the reading voice and only appears in the
  lightbox, where a plate is actually being examined.

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

- **On the map, three classes, told apart by material.** The **imprint** says
  whose chart this is and is not a control, so it has no container: ink
  straight onto the map. A **door** takes you elsewhere — the atlas, the menu,
  the account, the assistant — and every door is the same dark material, round
  for the icon-only ones and a pill where it carries a label. There is no
  "this one is different because it is an invitation": that distinction was
  real enough to write down and invisible to anyone looking at the map. **Instruments** change what you see of the current voyage — the
  lens rail, the transport bar, the world strip — and stay parchment
  rectangles. Shape carries the class a second time, so it is learnt in one
  look. They were all one material before, and the atlas door was being read as
  the wordmark's symbol.

  And a control is **one material all the way through**. The atlas door was a
  dark emblem with bare text beside it — half control, half words lying on the
  map — and that half read as a caption under the wordmark wherever the door
  was put. Where a control sits is rarely the defect; what it is made of
  usually is.

- **A legible control does not need to be taught.** If it needs teaching, the
  defect is in the control. The map already had a remembered first-visit
  overlay and voyages still could not be found — because an overlay that
  expires cannot fix a door nobody recognises, and after it expires the defect
  is back. Never reach for a timed or once-only explainer in place of making
  the thing readable.

- **The chrome says what you are looking at and that there is more.** The map
  shows one voyage of eighteen and used to carry a strapline where that fact
  belonged. A newcomer's two questions — what is this, and what else is there —
  need a permanent home, not an introduction.

- **Nothing on the map may share a pixel.** The left edge alone carries the
  rail, the basemap note and the welcome cartouche; the bottom carries the
  transport bar. They stack. Check every pair at more than one viewport — two
  of these collisions had been shipping, hidden by a third element sitting on
  top of them.

- **The arrangement is an attribute, not a media query.** There are two
  arrangements — `wide` and `phone` — and the one in force is published on
  `<html>` as `data-layout` by `lib/layout.ts` before first paint. Write the
  compact rule **beside** the rule it replaces:
  `[data-layout="phone"] .pig-launch { … }`. A media query forces the compact
  rule to live somewhere else in a 4900-line file, and that is not a matter of
  taste: `.pig-launch` has four `bottom` declarations across four responsive
  blocks, the furthest 1300 lines apart, and which wins is decided by source
  order alone. It is the four hand-set numbers again, one storey up. The
  boundary is spelled once, in `lib/layout.ts`; `useLayoutMode()` is for
  components that render a different **tree**, the attribute is for everything
  that only looks different. `test/layout.test.ts` fails the build if a
  viewport width is written by hand in TypeScript, or if the count of split
  selectors grows.

- **On a phone the chrome must not outweigh the subject.** With the derived
  stack in place and not one overlapping pair, the map page still spent **46%
  of a phone screen on chrome** and gave the voyage about 4% — five
  independent bands, each individually justified. Nothing was colliding and
  the page was still wrong, which is the whole lesson: past a certain width
  the defect stops being a number and becomes an arrangement. Measure the
  bands as a proportion of the viewport, not against each other.

- **A phone has no margin, so marginalia needs somewhere else to be.** The
  fifth voice is the hand annotating the edge — and at 390px there is no edge
  to annotate. The basemap note, six lines of mono, was not a note in the
  margin there; it was a paragraph laid over the subject. Marginalia on a
  phone becomes an affordance that opens it, never a band that asserts it.

- **A destination list is not layout, so it does not belong to the shell that
  draws it.** The doors were spelled four times — header, footer, and both map
  experiences — and three of the four went stale without a symptom anyone
  could see: the maps kept offering `/search` after the reform that retired it
  and never gained `/crew`; the footer never gained it either. Only the header
  was current, which is exactly why it went unnoticed. `lib/nav.ts` holds them
  now, and anything that merely LANDS somewhere (the search field) takes the
  named destination rather than the string. `test/layout.test.ts` fails if a
  shell spells a door again.

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

- Sizes and radii are **done**. 156 literal `font-size` values and 69
  `border-radius` values were mapped onto the scale in one pass. What is left
  is one 7px badge on a map marker — a pip, not text — and five `pt` sizes
  inside `@media print`, where points are the correct unit.
- The scale grew `--step--3` (0.62rem) doing it. The map's labels, kickers and
  readouts genuinely live at nine and ten pixels, and rounding them up to
  `--step--2` would have grown every legend by a fifth. A scale that does not
  reach where the design already is is not a scale.
- `--rule-*` and `--elev-*` have **zero** usages so far — the hairlines and
  shadows in the file are still ad hoc.
- **~270 colour literals** remain in `globals.css` — 18 paper grounds and 13
  chrome colours went to tokens with `--paper-rgb` and `--lens-*`. A good share are the token
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
- **The plates lens is migrated.** `.plates-thumb-btn` carried a 6px radius and
  an `rgba(255,255,255,0.4)` wash — the widget treatment the plate rule above
  exists to forbid — and the caption block used four hardcoded sizes. It is now
  `--radius-1`, `--rule-hair`, `--parchment-raised` and `--step--2`, and the
  `.space` override it needed went away because the theme re-declares the token
  itself. The lightbox is not fully migrated: `.plates-lightbox-cap` still has
  literal sizes.
- The **Quarterdeck overview is done** and is the reference for how a surface
  looks on this system — see `components/desk/Quarterdeck.tsx`, the first
  thing here built with no literal size, radius or colour. Its **submissions
  and crew tabs are not**: they are still inline styles and raw px.
- Other surfaces still off the system: `/account/agents`, the contribute
  panel, and `/connect` (which still has no opening at all).
- **Colour set on a canvas escapes the cascade entirely.** MapLibre paints the
  route in JS, so no theme could reach it and the Moon ran an Age-of-Sail
  oxide line. It reads `--route` off the container now. Anything else handed
  to a canvas or a WebGL layer — `SolarSystemMap`, `SolarSystem3D`, the empire
  fills, the border lines — is still literal and has the same problem.

- **A live view says when it is idle.** `/crew` is the watch bill: who has the
  deck now, who is below, what is on the stocks. Liveness is carried by facts
  that change — an elapsed time, a Scribe crossing from below to the watch, a
  new line in the log — and never by a pulsing dot, a glow or a shimmer, which
  the ornament rule forbids anyway. When nothing is happening the page says so
  in a sentence, on the same principle that makes a voyage declare a burnt
  archive: a dashboard that looks alive while idle is lying quietly.
- The **paper grain** is on `.tp-page` and on the specimen, and nowhere else.
  Extending it to the rest of the site is a decision nobody has taken.
- **No emoji remain in the interface** — but this line claimed that before it
  was true. One survived the sweep: `content: "📷"` on the plate badge, in CSS
  rather than in JSX, which is where the sweep looked. On a machine with no
  emoji font it rendered as tofu, a literal box, on the map beside a landfall.
  It is drawn now. **Grep CSS `content:` as well as JSX** before making this
  claim again. The remaining ones in the repo are the specimen's "was" column
  and the comment in `Icon.tsx`, both of which exist to record what was
  replaced.
- The **wordmark is settled**: engraved small caps, Cormorant 500, +0.2em, via
  the shared `.wordmark` class. Page titles are already Cormorant light in
  roman, so a roman wordmark would have stopped being a mark and become one
  more heading; and the wide tracking this file always asked of it is wrong in
  roman and obligatory in small caps.

- **The arrangement layer is installed; the stylesheet has not moved onto it.**
  `lib/layout.ts` owns the boundary and TypeScript no longer spells it — the
  two `matchMedia("(max-width: 680px)")` are gone. The CSS still has **27
  `@media` blocks across ten different breakpoints** (400, 560, 640, 680, 720,
  760, 820, 900, 1080, 1439), and six selectors are declared in more than one
  of them: `.pig-launch` ×4, `.transport-bar` ×3, `.world-strip` ×3,
  `.autopause-toggle`, `.win`, `.win-body` ×2. That list is frozen in
  `test/layout.test.ts` as a ratchet — it may shrink, never grow, and an entry
  repaid must be deleted from it in the same commit.
- **Two of the three map classes are primitives; the instruments are not.**
  `components/map/MapImprint.tsx` and `components/map/MapDoors.tsx` are shared
  by both experiences — they were identical JSX, and the Space copy had
  already lost the comments explaining why each piece is shaped as it is. The
  **instruments** are still built twice. They cannot simply be lifted: the rail
  and the transport bar have the same structure and a different vocabulary per
  subject (`Ship's Log` / `Mission Log`, `Off Brest` / `Near Neptune`, anchor /
  antenna). They want a shared arrangement that the voyage supplies a lexicon
  to — which is a design decision, not a move, and is not made yet.
- **The instruments are four bands on a phone and should be one sheet.** The
  derived stack holds them apart correctly. Holding them apart is not the
  same as arranging them.
- **Touch is unaddressed.** No `@media (hover: hover)` anywhere, so every
  `:hover` fires on tap and sticks; 36 `title=` tooltips are invisible on
  touch, including the whole icon-only lens rail. There is no tap-size token:
  `.tr-btn` is 40px, `.lens-btn-ico` ~30px, `.atlas-chip` ~19px, and
  `.play-btn` is 44px on a desktop and **shrinks to 36px on a phone**, which
  is backwards. `-webkit-tap-highlight-color` is unset, so Android paints a
  system blue over the paper. The bottom sheet draws a drag handle and does
  not drag, and has no `overscroll-behavior`.
- **`vh` where `dvh` is meant**: 15 against 3. The file already knows the
  difference (`.win-body`, the Pigafetta dock); it was not propagated, so a
  lightbox and the chat run under the browser's own bar.

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
