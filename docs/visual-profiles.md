# Editorial illustration profiles

Voyage logs treat engravings as page typography: a fixed, faint vertical mark
in the free left margin and, where fitting, a horizontal vignette at an article
break. They are decorative (`aria-hidden`), never evidence for a dated event.
Do not add captions, cards, wallpaper behind the reading column, or a second
margin image on phones. The design rules in
`.claude/skills/terraveler-design/SKILL.md` still govern all changes.

Every published entry in `lib/voyages.ts` **must** declare `visualProfile`.
`scripts/publish_submission.py` and `scripts/publish_route.py` generate this class automatically from
structured waypoint coordinates and ship metadata and prints it during
`--dry-run`. The editor may supply `--visual-profile` to correct its suggestion
before publication. A journey without a reliable match is `unillustrated`.
This is an explicit absence, not permission to use generic art.

| Profile | Allowed context | Current background | Article motif |
| --- | --- | --- | --- |
| `mesoamerica` | Predominantly Mesoamerican route | Cortés vertical terrain | Mesoamerican scene |
| `andes` | Predominantly Andean route | Andean vertical terrain | Andean scene |
| `marine-chart` | Charting or travel by ship without stronger regional fit | Nautical chart | Coast engraving |
| `mariner` | Narrative centred on mariners/captains | Nautical chart | Ship engraving |
| `unillustrated` | Unclear, unrelated, or non-Earth subject | None | None |

The renderer reads that class from the published Atlas entry, even when the
voyage record comes from PostgREST rather than bundled JSON. The catalogue in
`lib/voyageIllustrations.ts` maps class to eligible assets; CSS in
`app/globals.css` places them. A catalogue may contain multiple vertical
backgrounds for one class. Selection is stable per voyage slug, so adding a
variant rotates motifs across relevant articles without random changes during
reading. Add new assets only after checking subject, licence, page color,
desktop width, phone, and the absence of apparent historical claims.

This contract currently covers published **voyage log articles**. Other
content types should adopt the same profile and catalogue before displaying
automatic illustrations; they must not borrow voyage art implicitly.
