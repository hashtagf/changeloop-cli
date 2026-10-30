import { Option, Schema } from "effect"

declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string
declare const OPENCODE_ARTIFACT: string
declare const OPENCODE_RELEASE_HIGHLIGHTS: string
declare const CHANGELOOP_UPDATE_URL: string | undefined

// The one value that gives a build a Changeloop release channel: the base URL of its update API.
// Builds without it never check for, announce, or install updates.
const updateUrl =
  typeof CHANGELOOP_UPDATE_URL === "string" && CHANGELOOP_UPDATE_URL.trim() ? CHANGELOOP_UPDATE_URL.trim() : undefined
const version = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
const artifact = typeof OPENCODE_ARTIFACT === "string" ? OPENCODE_ARTIFACT : "cli"
// Stable release builds embed the release notes' Highlights; every other build has none.
const highlights =
  typeof OPENCODE_RELEASE_HIGHLIGHTS === "string"
    ? Option.getOrElse(
        Schema.decodeUnknownOption(
          Schema.fromJsonString(Schema.Array(Schema.Struct({ title: Schema.String, body: Schema.String }))),
        )(OPENCODE_RELEASE_HIGHLIGHTS),
        () => [],
      )
    : []

export {
  version as OPENCODE_VERSION,
  channel as OPENCODE_CHANNEL,
  artifact as OPENCODE_ARTIFACT,
  highlights as OPENCODE_HIGHLIGHTS,
  updateUrl as CHANGELOOP_UPDATE_URL,
}
export const OPENCODE_LOCAL = channel === "local"
