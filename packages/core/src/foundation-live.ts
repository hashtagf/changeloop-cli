export * as FoundationLive from "./foundation-live.js"

import { embeddedFiles, type Embedded, type Loader } from "@opencode/foundation/embedded-files"
import { FoundationWebui } from "@opencode/foundation/foundation-webui"
import type { FoundationRuntime } from "@opencode/foundation/foundation-runtime"
import { Effect, Layer } from "effect"
import { Foundation } from "./foundation.js"
import { FoundationDocuments } from "./foundation-documents.js"
import { FoundationDocumentReader } from "./foundation-document-reader.js"

export type Options = {
  /** Runtime that serves snapshots. `bundled` uses the release-bound runtime embedded in the build. */
  runtime?: FoundationRuntime.Mode
  runtimeOptions?: FoundationRuntime.MaterializeOptions
  /** Process environment for the runtime; defaults to the host environment at read time. */
  env?: NodeJS.ProcessEnv
  /** Replaces the dynamic import of the build-time embedded file map; exists for tests. */
  loadEmbedded?: Loader
}

export function layer(options: Options = {}) {
  const mode = options.runtime ?? "bundled"
  // Resolved once: a compiled build embeds the runtime files, a source run reads the vendored bundle.
  let embedded: Promise<Embedded> | undefined
  const files = () =>
    mode === "bundled" && !options.runtimeOptions?.files ? (embedded ??= embeddedFiles(options.loadEmbedded)) : undefined
  return Layer.mergeAll(
    Layer.succeed(
      Foundation.Service,
      Foundation.Service.of({
        read: (directory) =>
          Effect.tryPromise({
            try: async () => {
              const found = await files()
              if (found?.broken) throw new FoundationWebui.ReadError("runtime_unavailable", "Selected Foundation bundle is unavailable")
              return FoundationWebui.read(directory, mode, {
                ...options.runtimeOptions,
                ...(found?.files ? { files: found.files } : {}),
                ...(options.env ? { env: options.env } : {}),
              })
            },
            catch: (error) =>
              error instanceof FoundationWebui.ReadError
                ? new Foundation.ReadError(error.code, error.message)
                : new Foundation.ReadError("runtime_unavailable", "Foundation runtime is unavailable"),
          }),
      }),
    ),
    Layer.succeed(
      FoundationDocuments.Service,
      FoundationDocuments.Service.of({
        index: (directory, query) =>
          Effect.tryPromise({ try: () => FoundationDocumentReader.index(directory, query), catch: FoundationDocumentReader.failure }),
        read: (directory, query) =>
          Effect.tryPromise({ try: () => FoundationDocumentReader.read(directory, query), catch: FoundationDocumentReader.failure }),
      }),
    ),
  )
}

/** Answers every Foundation request as unsupported, for hosts that cannot run or read a Foundation project. */
export const unsupported = (() => {
  const failure = Effect.fail(new Foundation.ReadError("unsupported", "Foundation is not available on this server"))
  return Layer.mergeAll(
    Layer.succeed(Foundation.Service, Foundation.Service.of({ read: () => failure })),
    Layer.succeed(FoundationDocuments.Service, FoundationDocuments.Service.of({ index: () => failure, read: () => failure })),
  )
})()
