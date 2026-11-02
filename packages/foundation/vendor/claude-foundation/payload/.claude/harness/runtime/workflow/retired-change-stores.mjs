import { join } from "node:path";

// Per-change bookkeeping a retired change leaves under `.foundation/` that a
// later change reusing the id would otherwise inherit. Each entry is
// [quarantine name, source path]; a missing store root yields a null source.
//
// - authority/<id>, reviews/<id>: an exhausted review request (matched by
//   workspace hash) reopened instead of a fresh review budget.
// - instruction-manifests/<id>: manifests are joined to host executions by
//   digest, so a stale task scope became a drift candidate of the new change
//   (ambiguous attribution, or a blocking Land drift on a risky task id).
// - attestations/challenges/<id>.json: the open challenge an unconsumed signed
//   attestation still matches when the new packet has identical content, which
//   would authorize unattended work the new change never requested.
// - deliveries/<id>: Deliver resumes from this state, so a stale binding
//   refused the new change's delivery. A delivered pull request is an external
//   side effect: the record is moved into the retirement record, never deleted.
//
// attestations/used/ is deliberately absent: it is the global, nonce-addressed
// replay ledger and must outlive every change.
export function retiredChangeStores(stores, id) {
  const at = (rootPath, ...segments) => rootPath ? join(rootPath, ...segments) : null;
  return [
    ["authority", at(stores.authority, id)],
    ["reviews", at(stores.reviews, id)],
    ["instruction-manifests", at(stores.instructionManifests, id)],
    ["attestation-challenge.json", at(stores.attestations, "challenges", `${id}.json`)],
    ["deliveries", at(stores.deliveries, id)]
  ];
}

export function foundationChangeStores(root) {
  const foundation = join(root, ".foundation");
  return {
    authority: join(foundation, "authority"),
    reviews: join(foundation, "reviews"),
    instructionManifests: join(foundation, "instruction-manifests"),
    attestations: join(foundation, "attestations"),
    deliveries: join(foundation, "deliveries")
  };
}
