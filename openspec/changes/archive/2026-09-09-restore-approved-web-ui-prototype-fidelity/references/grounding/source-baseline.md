# Source baseline read before implementation

The original source was inspected before this correction; its observations are in the prototype drift investigation. This index retains paths and original digests without packaging executable code.

- changes.tsx: SHA-256 79ddb51abe55d3347842650ef13c546a1a108599362d3a00412657efa6a00a0a
- changes-view.tsx: SHA-256 12d323fa38ccdac59d54171c57f726c0aeabf65334e2a415335b6765f35e4ce6
- changeloop-brand.tsx: SHA-256 f95e73f6a1da7da59fe48ed257d16a6edb639325a24250ed6acd2c09cc730475

- packages/app/src/pages/changes.tsx: Server and Project selects replaced Home-style project navigation; investigation heading nested under Changes and category controls.
- packages/app/src/pages/changes/changes-view.tsx: list controls remained above details; generic overview facts preceded a full proposal reader.
- packages/app/src/components/changeloop-brand.tsx: padded 720x129 SVG displaced the session composer.

Executable regression coverage remains in packages/app/src/pages/changes and packages/app/e2e/regression/foundation-*.spec.ts, not this change packet.
