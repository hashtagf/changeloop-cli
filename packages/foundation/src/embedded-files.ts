/// <reference path="./virtual.d.ts" />

export type Embedded = { files?: Record<string, string>; broken?: true }

/** Replaces the dynamic import of the build-time embedded file map; exists for tests. */
export type Loader = () => Promise<Record<string, string>>

// A build without the module (source run, tests) uses the vendored bundle; a module that exists but fails to load
// is a broken release and must surface as a bundle failure instead of silently falling back.
export function embeddedFiles(load?: Loader): Promise<Embedded> {
  return Promise.resolve()
    .then(load ?? (() => import("virtual:opencode-foundation-files").then((module) => module.default)))
    .then(
      (files): Embedded => ({ files }),
      (error): Embedded => (isModuleNotFound(error) ? {} : { broken: true }),
    )
}

function isModuleNotFound(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  return (
    (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND" ||
    /Cannot find (module|package)/i.test(String((error as { message?: unknown }).message))
  )
}
