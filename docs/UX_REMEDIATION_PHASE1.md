# Terraveler UX Remediation — Phase 1

*Implementation plan based on browser-first UI/UX audit findings*

---

## P0-1 — MAKE THE VOYAGE EXPERIENCE SELF-EXPLANATORY

### P0-1 Lens System — Add contextual explanations

**Current state:** The lens rail contains 5 buttons (Log, Chart, Cartographer, Peoples, Plates) with only color-based active/inactive distinction. Tooltips are minimal and hover-dependent.

**Changes needed:**

1. **Add lens descriptions as tooltip/aria-label attributes** on each lens button in `components/VoyageExperience.tsx`:
   - **Log**: "Follow the voyage through the navigator's own words and journal excerpts"
   - **Chart**: "See navigation, position and route information including latitude, longitude and days at sea"
   - **Cartographer**: "Explore how geography and maps were understood in the voyage's era"
   - **Peoples**: "Explore encounters, populations and cultures represented in the sources"
   - **Plates**: "View visual evidence, illustrations and historical imagery from the log"

2. **Desktop**: Add subtle CSS tooltip that appears on `focus` and `hover` (gated by `@media (hover: hover)`). The tooltip should have a modest background and border that fits the parchment aesthetic.

3. **Mobile/touch**: Replace hover-dependent tooltap with a tap-to-reveal mechanism. When a lens button is tapped, briefly show the description then return to normal state. Alternatively, add a small "i" icon beside the lens that opens a dismissible contextual note.

4. **First-use guidance**: When a user first enters a voyage detail page, show a brief contextual banner: "Explore this voyage through different lenses. Tap or hover lens buttons for explanations." This should be dismissible and not reappear.

**Files to modify:**
- `components/VoyageExperience.tsx` — lens button additions and tooltip logic
- `app/globals.css` — add tooltip styling that fits the editorial design system

---

### P0-1 Voyage Timeline — Improve affordances

**Current state:** The timeline shows progress through the voyage with segments and a current position marker. Some users aren't sure what the segments represent or if the timeline is interactive.

**Changes needed:**

1. **Current position indicator**: Ensure the current position on the timeline is clearly marked with a distinct badge or marker that says "Here" or shows the current landfall name.

2. **Interactivity cue**: Add a subtle affordance indicating the timeline is interactive. This could be:
   - A change in cursor to `pointer` on timeline segments
   - A faint hover/tap highlight effect (gated by `@media (hover: hover)`)
   - The existing segment click functionality is already present — just ensure the cursor and visual feedback make this clear

3. **Segment labels**: Consider adding tiny labels or numbers on timeline segments that show "Landfall N" or the segment's significance, without cluttering the visual view.

4. **First-use hint**: On first visit, briefly indicate that the timeline can be clicked to jump between landfalls. This could be part of the same dismissible banner used for lens explanations.

**Files to modify:**
- `components/VoyageExperience.tsx` — timeline marker and segment styling
- `app/globals.css` — timeline segment hover/focus styles

---

### P0-1 World Events / World Timeline — Clarify function

**Current state:** The world timeline places the voyage in its wider historical context. Its function isn't immediately obvious to new users.

**Changes needed:**

1. **Concise label**: Add a small subtitle or label near the world timeline: "What was happening in the world while this voyage sailed"

2. **Tooltip**: Add a hover/focus tooltip: "This shows contemporary events, discoveries, and political contexts from the same period as the voyage"

3. **First-use hint**: Include in the dismissible introductory banner: "The world timeline places this voyage in its broader historical context. Hover or tap for details."

**Files to modify:**
- `components/VoyageExperience.tsx` — world timeline label and tooltip
- `app/globals.css` — world timeline styling

---

### P0-1 TransportBar — Clarify meaning

**Current state:** The TransportBar shows position data (latitude/longitude, distance, days at sea, etc.) but some values aren't immediately understandable.

**Changes needed:**

1. **Current location**: Ensure the current place name is prominently displayed with large, readable typography.

2. **Voyage/date context**: Add clear labeling of the current date or progress through the voyage (e.g., "Landfall 3 of 12" or the current date range).

3. **Key measurements**: For each data field, add a small, subtle descriptor on first use. For example:
   - "Days at sea: How long the voyage has been at sea"
   - "Position certainty: The navigator's confidence in the ship's location"
   - "Sailed so far: Total distance traveled since departure"

4. **Avoid increasing visual density**: Use the existing token system for spacing and sizing. Subtle color or font-size distinctions are preferable to adding new elements.

**Files to modify:**
- `components/VoyageExperience.tsx` — transport bar content and labeling
- `app/globals.css` — transport bar token usage

---

## P0-2 — PIGAFETTA MOBILE DISCOVERABILITY

### Change the icon

**Current state:** The Pigafetta launcher uses a compass icon (🧭) on mobile, which communicates navigation rather than conversation.

**Change:** Replace the compass icon with a symbol that immediately communicates AI assistant/chatbot.

**Preferred option:** 🤖 (robot face emoji)

**Alternative (if emoji clashes with aesthetic):** A small human/person icon that clearly communicates "assistant" and isn't confused with user profile, account, crew, or contributor identity.

**Implementation:** Update the Pigafetta pill component in `components/Pigafetta.tsx` to use the new icon. Ensure it remains 48×48px on mobile per the `--tap-min` design system constraint.

### First discovery

**Change:** Add a lightweight label "Ask Pigafetta" that appears on first interaction or first relevant visit, then disappears, leaving the compact button sufficient.

**Implementation:** 
- Add a dismissible label that appears near the Pigafetta pill on the first visit/tap
- Use a data attribute like `data-pigafetta-first-visit` to track whether the user has interacted
- The label should fade in on first visit, and be removed after the user taps the pill or after a short time

### Touch bug

**Change:** Investigate and fix any hover/touch behaviour involving Pigafetta.

**Specific fix:** 
- React `onMouseEnter` / synthetic touch behaviour must not cause explanatory panels to remain stuck open on Android or touch devices
- Use pointer/touch appropriate behaviour — show explanatory content on tap, not hover
- Ensure the Pigafetta mini-panel `.pig-mini` properly dismisses on tap outside or with an explicit close control

**Files to modify:**
- `components/Pigafetta.tsx` — touch behaviour and first-discovery label
- `app/globals.css` — any hover-dependent styles that need touch adaptation

---

## P1-1 — SEARCH: MAKE NO RESULTS HUMAN-FIRST

**Current state:** When no search results are found, the "Not in the atlas — yet" section shows a heavy AI prompt that immediately exposes MCP/agent concepts.

**Desired flow:**

### Primary response (human-first)
- Clearly tell the human: "This isn't in the atlas yet."
- Provide a simple primary action: "Suggest this voyage" or "Suggest this subject"

### Secondary / advanced path
- Then expose: "Contribute with your AI agent" or equivalent
- Only at this deeper layer should the UI reveal: MCP, agent prompt, handle, API key, get_contract, technical integration instructions

**Implementation in `components/AtlasSearch.tsx`:**

1. **Primary CTA**: Change the "Copy the prompt for your AI" button to "Suggest this voyage" that links to `/contribute`

2. **Secondary path**: Make the AI prompt collapsible or hidden by default, revealed only when the user clicks "Contribute with AI agent" or similar

3. **Progressive disclosure**: Keep the technical content available for agent users, but don't surface it to casual users

**Files to modify:**
- `components/AtlasSearch.tsx` — no-results flow restructuring
- Potentially `app/api/search` — if query recording needs adjustment

---

## P1-2 — VOYAGE VISUAL HIERARCHY

**Current state:** The voyage detail page has many meaningful elements (map, lens rail, world timeline, transport bar, Pigafetta) that compete for visual attention. No clear primary/secondary hierarchy.

**Changes needed:**

1. **Map as visual anchor**: Ensure the map remains the dominant visual element. It should have the strongest visual weight on the page.

2. **Title area**: The voyage title and essential context (era, current landfall) should be clearly readable but not compete with the map.

3. **Secondary systems support rather than compete**:
   - **Lens rail**: Should be visually distinct but subordinate to the map. Active state should be clear without being the strongest visual element.
   - **World timeline**: Should be noticeable but not draw primary attention. A subtle underline or divider can indicate its relationship to the voyage.
   - **TransportBar**: Should be compact and informative without demanding focus.
   - **Pigafetta**: Should be available but not dominant.

4. **Improve hierarchy through**:
   - **Visual weight**: Map gets the most; secondary elements get less
   - **Opacity**: Inactive elements get lower opacity
   - **Spacing**: Group related elements; separate unrelated ones
   - **Transition**: Smooth transitions when lenses change, but don't animate everything
   - **Collapsed/expanded states**: Lens rail can collapse on mobile; transport bar is already compact
   - **Contextual revelation**: Show secondary information when relevant, not permanently

**Implementation approach:**
- Review and tune the CSS in `app/globals.css` for visual weight adjustments
- Modify `components/VoyageExperience.tsx` as needed for hierarchy changes
- Preserve all existing functionality — only restyle for clearer hierarchy

**Files to modify:**
- `app/globals.css` — visual weight, opacity, spacing adjustments
- `components/VoyageExperience.tsx` — any structural changes for hierarchy

---

## P1-3 — MOBILE TRANSPORTBAR PROGRESSIVE DISCLOSURE

**Current state:** The mobile TransportBar is already reduced to 97px and is a significant improvement. The goal is progressive disclosure of secondary fields.

**Changes needed:**

1. **Preserve compact architecture**: Do NOT redesign from scratch. Keep the existing structure.

2. **Essential fields permanently visible**: 
   - Current place name
   - Voyage/date or temporal position
   - One or two meaningful progress measurements (e.g., distance sailed, days at sea)

3. **Secondary fields via tap/progressive disclosure**:
   - Make available through: tap, expansion, details drawer, contextual popover, or another touch-native pattern
   - Examples: last passage duration, ports made count, position certainty badge

4. **Long place names**: Ensure they remain understandable. Avoid aggressive truncation that removes geographic meaning. The existing `-webkit-line-clamp: 2` should be sufficient, but may need fine-tuning.

**Implementation approach:**
- Review the existing mobile TransportBar in `components/VoyageExperience.tsx` 
- Identify which fields are essential vs. secondary
- Add tap handlers or expansion mechanisms for secondary fields
- Ensure the overall bar height remains reasonable

**Files to modify:**
- `components/VoyageExperience.tsx` — mobile transport bar field selection and progressive disclosure
- `app/globals.css` — mobile transport bar styling adjustments

---

## P2-1 — VOYAGE CARD INTERACTION

**Current state:** Voyage cards have both a clickable title and a "Read the log →" link. Both may lead to the same voyage, creating ambiguity about the primary action.

**Changes needed:**

1. **Entire card clickable**: Make the whole voyage card act as a single clickable entry point to the voyage detail page.

2. **Preserve "Read the log →" affordance**: Keep the "Read the log →" link visible but make it secondary to the card click.

3. **Retain title hierarchy**: The voyage title should remain the prominent text on the card.

4. **Keyboard accessibility**: Ensure the card is keyboard-focusable and activates on `Enter` or `Space`.

5. **Avoid nested-interaction conflicts**: The card click shouldn't conflict with inner element clicks (like lens buttons or Pigafetta).

**Implementation approach:**
- In `app/voyages/page.tsx`, make the voyage card article clickable
- Keep the "Read the log →" link functional but ensure the card itself is the primary entry point
- Test keyboard navigation (Tab to card, Enter to activate)

**Files to modify:**
- `app/voyages/page.tsx` — voyage card clickability

---

## P2-2 — ACCESSIBILITY COLOUR MARGIN

**Current state:** Several semantic tokens sit at or very near the WCAG AA 4.5:1 contrast threshold.

**Changes needed:**

1. **Review semantic tokens**: state (`--state-*`), confidence, lenses, provenance, status

2. **Where contrast is barely above 4.5:1, provide ≥5:1 margin**:
   - `--state-wait: #82632b` at 4.51:1 → adjust to ≥5:1
   - `--state-idle: var(--ink-faint)` at 4.51:1 → adjust
   - `--lens-carto: #8a5f22` at 4.54:1 → adjust
   - `--brass-text: #7c5723` at 5.24:1 on parchment, 4.74:1 on grain → adjust for grain/space themes

3. **Small token adjustments**: Prefer small color value adjustments over dramatic palette changes.

4. **Test important themes/backgrounds**: Verify on `.light` (parchment), `.space`, and `.worlds` body themes.

5. **Do not add text shadow as a default fix**: Only use if there is a genuine visual reason.

**Implementation approach:**
- Adjust the `:root` token values in `app/globals.css` slightly to increase contrast margin
- Re-verify on `/specimen/palette` across all theme variants
- Make minimal adjustments to hue or lightness rather than complete color changes

**Files to modify:**
- `app/globals.css` — token value adjustments in `:root`

---

## P2-3 — DESIGN SYSTEM DEBT

**Current state:** Raw colour/style values outside the token system exist in several components.

**Changes needed (incremental, during other work):**

1. **Whenever touching a component during this remediation**:
   - Use existing tokens where appropriate
   - Remove obvious local duplication
   - Avoid introducing new hard-coded visual values
   - Improve nearby implementation when safe

2. **Record larger design-system debt separately**: Do not let cleanup expand the scope of this UX pass.

**Implementation approach:**
- As components are modified for other priorities, naturally convert any raw values to tokens
- Document any remaining debt in a separate ticket/issue
- Do not perform a repository-wide migration during this remediation

**Files to monitor during other changes:**
- Any component being modified for P0-P1 priorities
- New values introduced should reference `:root` tokens

---

## P3 — PEOPLES LENS

**Current state:** The Peoples lens is disabled with "coming soon" tooltip.

**Decision needed based on product state:**

**Option 1**: Hide it until meaningful content exists
- Remove the disabled lens button until there's actual content to show
- Prevents users from seeing a broken control

**Option 2**: Keep it visible but make its future purpose explicit
- Replace the disabled control with a clear statement like "Peoples — coming soon: view historical demographics and cultures"
- Avoid a generic "appears broken" appearance

**Avoid**: Inventing a release date or inventing functionality.

**Implementation**: Decision based on current content state. If the product has Peoples-related content, implement Option 2. If not, implement Option 1.

**Files to modify:**
- `components/VoyageExperience.tsx` — lens rail Peoples button handling

---

## FILES TO MODIFY SUMMARY

Based on the priorities above, the following files will need modification:

1. `components/VoyageExperience.tsx` — lens system, timeline, world events, transport bar, Peoples lens, voyage visual hierarchy
2. `components/Pigafetta.tsx` — mobile icon, touch bug, first-discovery label
3. `app/voyages/page.tsx` — voyage card clickability
4. `app/globals.css` — token adjustments, tooltip styling, visual hierarchy, accessibility colours
5. `components/AtlasSearch.tsx` — no-results human-first flow

---

## IMPLEMENTATION ORDER

1. **P0-1** (Voyage experience self-explanatory) — lens, timeline, world events, transport bar
2. **P0-2** (Pigafetta mobile discoverability) — icon, first discovery, touch bug
3. **P1-1** (Search no-results human-first) — progressive disclosure of agent concepts
4. **P1-2** (Voyage visual hierarchy) — map as anchor, secondary systems support
5. **P1-3** (Mobile TransportBar progressive disclosure) — essential vs. secondary fields
6. **P2-1** (Voyage card interaction) — entire card clickable
7. **P2-2** (Accessibility colour margin) — token adjustments for ≥5:1 contrast
8. **P2-3** (Design system debt) — incremental token conversion during other work
9. **P3** (Peoples lens) — hide or make explicit based on content state

---

## VALIDATION

Test at minimum:

**Desktop:**
- Homepage, Voyage detail, Search success, Search no-results
- All functional lenses, Timeline interaction, World events, TransportBar
- Pigafetta desktop behaviour

**Mobile/narrow viewport:**
- Homepage, Voyage detail, Pigafetta launcher/open/close
- Lens interaction (tap), Voyage timeline, World timeline integration
- TransportBar (essential vs. secondary fields), Long place names
- Touch-only interactions, Search no-results

**Regression checks:**
- Desktop World timeline remains available where intended
- Phone does not regain a duplicate top World strip
- No map controls are hidden behind overlays
- No horizontal page overflow
- No essential feature requires hover on touch
- Pigafetta does not latch open on Android-like pointer behaviour
- Timeline remains usable
- Map remains the dominant voyage surface
- No accessibility regression
- No major visual identity regression

---

## REPORTING

When finished, report:

### Changes implemented
For every priority: implemented / partially implemented / not implemented. Explain why.

### Files changed
List all files touched and the purpose of each change.

### UX behaviour before / after
For every meaningful change explain:
- Before: What the user experienced
- After: What the user now experiences

### Desktop validation
Report tested behaviour.

### Mobile validation
Report tested behaviour. Include viewport size.

### Tests
Report: tests run, results, any new tests added, any existing test modified.

### Remaining issues
Only list genuine remaining UX issues related to this remediation.

---