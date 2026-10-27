# Change: Redraw the CLI banner as a pixel wordmark with loop icons replacing both O letters

## Why

The user finds the block-glyph banner unattractive and asked for a pixel-style CHANGELOOP wordmark whose two O letters are the loop icon

## What changes

- A 5-row pixel-font wordmark spells CHANGE (left, dim) and L<loop><loop>P (right, bright) where both O letters are a circular-arrow loop icon
- All three logo sites carry the same pixel rows; the logo test pins the new rows and the loop-icon glyph

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none

## Non-goals

- No renderer changes beyond the glyph data; the go glyphs, colors, and draw functions stay as-is
