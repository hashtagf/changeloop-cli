// The runtime's own declaration of which entrypoint it expects.
//
// `foundation.mjs` and `runtime/**` are installed and copied as a pair, but
// nothing forced them to *be* a pair: no module under runtime/ declared a
// version, so the only version check compared foundation.mjs's constants
// against protocol.json — the wrong axis entirely. A mixed tree therefore
// passed `api-version`, `version`, `doctor`, `prove` and `land-check`, and
// then threw at `archive`, the last step of Land.
//
// The asymmetry is why it reads as a flake: an old entrypoint calling into new
// modules crashes on a function that does not exist yet, while the reverse
// passes an extra argument an older module quietly ignores.
//
// Bump this together with RUNTIME_API_VERSION in foundation.mjs whenever the
// boundary between the entrypoint and these modules changes shape.
export const RUNTIME_MODULE_API = "23";
