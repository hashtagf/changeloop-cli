declare module "virtual:opencode-foundation-files" {
  /** Relative bundle path (`manifest.json`, `payload/...`) to the embedded file's path; supplied by the CLI build. */
  const files: Record<string, string>
  export default files
}
