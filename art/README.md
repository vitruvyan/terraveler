# Source artwork

Drawings the icon set is derived from, kept because a 24-unit path with the
transform baked in cannot be edited back into a drawing.

- `morion.svg` — the conquistador's helmet, hand-drawn. `components/Icon.tsx`
  carries it rebased into the 24×24 box: the transform was pure scale and
  translation, so the coordinates are exact rather than approximated, with the
  source's degenerate segments dropped and the precision trimmed to two
  decimals. If the drawing changes, re-derive from this file rather than
  editing the path in the component.
