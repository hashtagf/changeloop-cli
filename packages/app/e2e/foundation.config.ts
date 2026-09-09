import { defineConfig } from "@playwright/test"
import config from "../playwright.config"

// The verification runner owns the authenticated, embedded binary and teardown.
export default defineConfig(config, { testDir: ".", outputDir: "./test-results", webServer: undefined })
