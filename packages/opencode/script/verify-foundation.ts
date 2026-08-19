#!/usr/bin/env bun

import path from "path"
import { createEmbeddedFoundationBundle } from "./foundation-bundle"

const vendor = path.resolve(import.meta.dir, "../vendor/claude-foundation")
const result = await createEmbeddedFoundationBundle(vendor, !process.argv.includes("--allow-untagged"))
console.log(`verified Foundation ${result.manifest.release} (${result.manifest.files.length} files)`)
