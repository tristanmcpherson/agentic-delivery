import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./tests",
  timeout: 20_000,
  retries: 0,
  reporter: [["line"], [path.resolve("plugins/vision/assets/playwright/agentic-reporter.mjs")]],
  forbidOnly: true,
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node server.mjs",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: true,
    timeout: 10_000
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
