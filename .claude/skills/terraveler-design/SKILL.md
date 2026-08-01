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

- **`vh` is a promise about a bar that moves; choose the unit, do not default
  to one.** `dvh` for anything that must fit the screen *as it is now* —
  overlays, dropdowns, scroll panes — because a retracting bar should give them
  room rather than leave them clipped. `svh` for anything that must **not** move
  when the bar does: section floors, padding, images in the flow, where
  re-sizing mid-scroll is a reflow the reader feels as jitter. Reaching for
  `dvh` everywhere is the common mistake and it makes documents twitch. The one
  that survived longest here was `.win-body`, which held `60vh` inside a `min()`
  against `100dvh` — so a retracting bar grew one term and left the other, and
  which of the two was the real cap could change halfway through a scroll.
  `test/layout.test.ts` fails on a bare `vh`.

- **The safe area is unreachable until the document asks for the whole screen,
  and harmful the moment it does.** `env(safe-area-inset-*)` resolves to **zero**
  under the default viewport, so those four values could have been written into
  this stylesheet at any point in the last year and changed nothing. Turning
  them on is `viewportFit: "cover"` in `app/layout.tsx` — and `cover` without
  insets is strictly worse than neither, because it runs the map's chrome under
  the notch and the home indicator. They ship together; a guard enforces it. The
  bottom one is folded into `--edge`, which the entire derived stack rides on,
  so the home indicator is answered in one place rather than six that would then
  have to be kept in agreement.

- **A z-index only orders you against your siblings.** The map's panels sat
  under the lens rail, the launcher and the transport bar for months while
  carrying `z-index: 30` against their 6, 7 and 11 — because they live inside
  a `<div style="position:absolute; z-index:0">` that wraps the map, and the
  chrome are siblings of that wrapper. Thirty inside a nought is a nought. It
  is unfalsifiable by reading either rule on its own, which is why an earlier
  fix moved MapLibre's attribution out of the bar's way instead: the symptom
  was reachable and the cause was not. **Before tuning a z-index, walk the
  ancestors** — anything with a `z-index`, a `transform`, a `filter`, an
  `opacity` below 1 or `isolation` starts a new scale and traps everything
  below it. A wrapper that only exists to group does not need a z-index.

- **On a phone a panel is a page, not a window.** As a half-height sheet the
  Ship's Log was the worst surface on the site: the rail on its title, the
  launcher and the bar across its text, the basemap note legible through it,
  the reading running off the bottom with nothing to say it continued. Every
  one of those follows from being a small translucent thing among other small
  things. Full bleed, opaque, its own scroll, `overscroll-behavior: contain`.
  While you are reading the log you are not looking at the map, and pretending
  otherwise is what cost the text its legibility.

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

## The second renderer is already here, and it is the canvas

**There is no plan to rewrite this site in React Native, and a previous version
of this section said there was.** That was written from a target named in
passing, and it was the wrong target for two reasons that are worth keeping.

The first is in this repo's own history. `10916eb` records the imprint being
written twice — two files, *one language, one codebase* — and drifting apart in
silence for weeks: a retired destination still offered, the Space copy stripped
of the comments explaining its own shapes. Two copies in one language diverge.
Two copies in two languages, maintained by one person, diverge faster and deeper.

The second is that the product **is** the typography: three self-hosted cuts,
OpenType features subset by hand, contrast measured rather than claimed,
hairlines at 1px. Native text rendering honours exactly those features least
reliably — the Quarterdeck has already printed `O I I` because one was merely
absent. Rewriting in RN pays the highest available price to damage the one thing
that distinguishes the site.

**The route is the web, in three steps.** A mobile site as robust as the desktop
one; then installable (manifest, offline, safe area) so it has an icon and a full
screen; then a native shell only where a store requires it — cheap on Android,
and on iOS only with something genuinely native to offer, because Apple rejects
thin wrappers.

So why does this section survive at all? Because **the second renderer already
exists and it is not a phone — it is the canvas.** MapLibre paints the route in
JS and Three.js paints the orrery in WebGL, and neither can read the cascade.
That is not a hypothetical: it is the defect in the debt list below, the one that
made the Moon run an Age-of-Sail oxide line, and the workaround was to read
`--route` off a container at runtime. Every other canvas colour in the repo is
still a literal for the same reason.

Which gives the rule its real justification, owed today rather than banked
against a rewrite that may never happen:

**A value something other than the stylesheet needs is authored in TypeScript and
emitted to CSS. Everything else stays where the arrangement rule puts it.**

So the token layer inverts. `:root` stops being the SSOT and becomes generated
output; a `lib/tokens.ts` holds the values and everything reads it — the
stylesheet, the map, the orrery, and anything later. Nothing changes about how
CSS is written: `var(--ink)` is still what you type. `/specimen/palette` gains,
because it can measure the declared source against the computed result and say
when the two have parted. Measured: **113 declarations** across `:root`, `.space`
and `.worlds`, against **1328** `var()` uses — a day of work, and the layer will
never again be this small.

This is in tension with the arrangement rule above, and the tension is stated
rather than smoothed over: "the attribute for everything that only looks
different" deliberately fills the cascade, and the cascade is what a canvas
cannot read. The rule is not repealed. It is bounded by the sentence in bold.

**What was already right, and stays right.** `lib/layout.ts` and
`lib/useEdgeStack.ts` put the boundary and the edges in TypeScript because four
hand-set numbers could not be held consistent — and that decision now also means
a second reader can have them. `lib/nav.ts` is the same shape. And **a panel is a
page** was not a concession to small screens: it is what the surface wanted once
it was measured.

**What is owed, in the order it is owed:**

- ~~The viewport unit, and the ground under it.~~ **Repaid** — see the debt list.
  It was first because it is what makes the site robust on a real phone today,
  and because an installable app would have made the same defect permanent as
  the safe area, where no scroll recovers it.

- **Hover does not exist under a finger.** Repaid: all 78 rules are gated and a
  guard holds the line. What remains is the **63 `title=`** tooltips — Close,
  Menu, Collapse, The Atlas, the whole icon-only rail — which say nothing to a
  thumb and never will.

- **The token layer inverts**, for the canvas reason above.

- **The register is cascade-only.** `.space` on `body` reaches its subjects
  through descendant selectors. Anything that is not the stylesheet — the map,
  the orrery — cannot follow that, which is why they hardcode. A register wants
  to be a React context *as well as* a class: the class for the stylesheet, the
  context for everything else. The layout mode already has its hook and is the
  pattern to copy.

- **The instruments want a shared arrangement with a per-subject lexicon**, which
  is already the named debt. Two hand-built copies are two things to fix every
  time; one arrangement taking a lexicon is one. The same holds for "four bands
  should be one sheet".

And one thing to stop assuming, which follows from the subsetting trap below: the
typographic argument rests on OpenType features asked for in CSS — `lnum`,
`onum`, `smcp`, `tnum` — and they fail *silently* when absent. This is why the
route above stays in a browser for as long as it can. Assume nothing about the
figures anywhere the renderer changes until they have been looked at on a
device.

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
- **Touch: hover and the press are repaid, the sizes are not.** All **78** hover
  rules across both stylesheets now sit inside `@media (hover: hover)`, so none
  of them fires on tap and sticks; `test/layout.test.ts` fails the build if one
  is added outside the gate. Every one of them was visual feedback rather than
  revealed content, which is why the gate loses nothing.

  The press highlight is **recoloured, not removed** — `--tap-flash`, which each
  register re-declares and a guard enforces. Removing it is the obvious move and
  it is wrong: this file has exactly one `:active` rule in 5000 lines (a grab
  cursor), so transparent would leave a tap unacknowledged, and the generic
  replacement everyone reaches for — dipping opacity — is forbidden by the
  z-index rule above, since an opacity below 1 opens a stacking scale.

  `--tap-min: 44px` is declared, and it **records** a floor the file had already
  chosen three times by hand rather than importing a platform's number. It is
  applied so far only to `.tr-btn` (40 → 44), keyed to `(pointer: coarse)`
  rather than to the arrangement, because a touchscreen laptop is `wide` and
  still has no pointer. Safe to add without re-measuring only because the bottom
  edge is a derived stack that measures the bar rather than being told its
  height.

  **Still owed:** `.lens-btn-ico` (~30px) and `.atlas-chip` (~19px). Neither is a
  size fix. The rail is a vertical column centred on the map, so 30 → 44 grows
  it by 14px per lens in the middle of the subject; a chip row where every chip
  is 44 tall stops being a chip row. Both are the lesson this file already
  learnt one storey down — past a certain point the defect stops being a number
  and becomes an arrangement — and both want measuring on a real engine first.
  Also owed: the **63 `title=`** tooltips, invisible on touch and absent on
  native, including the whole icon-only rail; and the fact that there is no
  `:active` treatment anywhere, so the platform highlight is now the only press
  feedback the site has.

  *Repaid earlier:* the play button no longer shrinks to 36 on a phone, the
  Pigafetta door is 48, the note chip is 44, and the drag handle that never
  dragged is gone with the sheet it was drawn on.

- **Three top-level selectors are declared more than once and silently overwrite
  themselves**: `.tr-btn` twice (the first block's `background` and `color` are
  dead — the second sets both) and `.lens-rail` three times. This is the
  split-across-media-blocks disease without the media blocks, and the ratchet in
  `test/layout.test.ts` does not see it because nothing here is responsive.
  Found while sizing the transport bar; not fixed, because untangling which
  declaration is load-bearing wants the surface in front of you.
- **The transport bar is still two rows on a phone**, because the autopause
  checkbox is a setting with nowhere else to live. Hiding its label was tried
  and reverted within the hour: it left a naked box in the middle of the bar,
  which is a control that must be taught. The row is the honest price until
  the setting is given a home off the map.
- **The chrome share, measured on the owner's own handset (412×883): 34.1% →
  22.3%.** Overlapping pairs 5 → 0, controls under 44px 20 → 5, and three of
  the five left are MapLibre's own or the wordmark. What moved:

  - the **world strip** leaves the top of a phone entirely. It was a 45px band
    encoding the same time axis as the bar at the other end of the screen —
    two timelines at opposite edges of a small screen — and it arrives in the
    bar as a second track behind a two-tab switch. It also opened on `hover`,
    which does not exist under a finger, so down there it said nothing anyway.
  - the **autopause checkbox** is gone from the phone, and not by being hidden:
    it became the behaviour. The voyage always stops at a landfall, the log
    opens, and the log carries the button that sails on. A control in context
    instead of a preference in the abstract. **The price, taken knowingly: a
    phone can no longer watch a voyage play through unattended.**
  - the **stage steppers** live on the log, beside the thing they step between.
  - MapLibre's attribution collapses to its own `(i)`: **338×44 → 56×44**.
    Collapsed, not removed — OSM and CARTO are still credited and the compact
    form is the library's own.

  The bar is **131px**, down from 165. It is not two rows: `.voyage-track` is
  forced to `flex: 1 1 100%`, so the rail always takes one of its own.

- ~~The timeline ticks are 2px wide.~~ **Repaid.** They measured 2×8, fifteen
  across a 340px rail, and no tap floor fixes that — fifteen 44px targets do
  not fit in 340px at any size. On a phone they are printed marks now,
  `aria-hidden` and out of the tab order, and stepping moved to the log. The
  scrubber keeps its 4px rule and gained a 44px target by growing into padding
  and putting the drawn track back with `background-clip`; the alternative, a
  thicker line, answers touch by giving up the drawing.

- **The transport bar is built once.** `components/map/TransportBar.tsx`, with
  a lexicon — this is the instrument debt below, repaid for this one instrument.
  The orrery has no MapLibre, so the attribution collapse has no second home to
  drift from; everything else lands in both atlases from one file.

- **`button.map-atlas-door` carries a `title` and no `aria-label`.** It is the
  door to the whole atlas — "18 voyages" — and on touch it says nothing, to a
  finger or to a screen reader. It is 65×29, also under the floor. The measuring
  script flags `title-only` controls for this reason.
- **The viewport unit and the safe area are repaid.** No bare `vh` remains in
  either stylesheet: 14 `dvh` where a thing must fit the screen now, 6 `svh`
  where it must not move, each classified by what the rule is for rather than
  converted wholesale. `viewportFit: "cover"` is declared — there was no
  `viewport` export at all, so `env()` had been resolving to zero — and the four
  `--safe-*` tokens are read by `--edge` (and through it the whole bottom
  stack), `.map-top` and the lens rail. Two guards: no bare `vh`, and cover and
  the insets may not ship without each other.

  **Not verified on a device.** There is no headless browser on the build
  machine, so nothing here was measured at 390×844 the way c5ff173 was, and a
  notch cannot be simulated by reading CSS. The insets are believed correct and
  have not been seen.
- **The token layer is still authored in CSS**, which the canvas makes a defect
  rather than a choice: MapLibre and Three.js cannot read a custom property, so
  every colour they draw is either a literal or a runtime read off a container.
  113 declarations in `:root`, `.space` and `.worlds`, plus one declared locally
  in `.wp-dot.has-media::before` — a token living outside any register, which by
  this file's own logic is either not a token or a missing one. Nothing is
  generated and there is no `lib/tokens.ts`.

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

And the map on a phone is measured, not read:

```
node scripts/measure-phone.mjs [url] [width] [height]
DISMISS=1 node scripts/measure-phone.mjs   # the returning reader, no cartouche
```

It enumerates every positioned element over the map with its rectangle, its
computed z-index and **the ancestor that traps it** — the thing that made a
z-index of 30 behave as a nought — then checks *all* pairs for collisions rather
than the ones someone thought to name, sums the union of the bands as a share of
the viewport, and lists every control under 44px, flagging the ones whose only
label is a `title`. It asserts nothing: the numbers are the output, and what
counts as too much is a judgement made by a person looking at them.

Two of its findings were unreachable by reading: the timeline ticks are 2px
wide, and the chrome share had grown back to 31.6% while the debt list still
said 25.4%. `--safe-*` will read as `0px` here — headless Chromium has no notch,
so the insets still cannot be verified this way.

Check both a wide viewport and ~390px. Wide content (tables, logs, code) scrolls
inside its own container; the page body never scrolls horizontally.
