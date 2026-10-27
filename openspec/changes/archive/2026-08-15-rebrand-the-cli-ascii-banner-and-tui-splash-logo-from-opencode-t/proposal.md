# Change: Rebrand the CLI ASCII banner and TUI splash logo from opencode to changeloop

## Why

The --help banner and TUI splash still spell opencode after the user-visible string rebrand; the user asked for the banner to say changeloop

## What changes

- The block-glyph logo spells changeloop (left half 'change', right half 'loop') in all three sites, keeping the existing glyph vocabulary and dim/bright split rendering
- A deterministic test pins the non-TTY wordmark output and the glyph-table consistency (equal row widths, left/right alignment)

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none

## Non-goals

- No change to the 'go' glyphs, scriptName, help text, or any functional identifier
- No redesign of the logo style; same block font vocabulary and colors
