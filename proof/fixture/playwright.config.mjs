import { defineConfig } from "@playwright/test";
import path from "node:path";

const appOrigin = process.env.AGENTIC_APP_ORIGIN || "http://127.0.0.1:46200";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 1,
  reporter: [["line"], [path.resolve("plugins/agentic-delivery/assets/playwright/agentic-reporter.mjs")]],
  forbidOnly: true,
  use: {
    baseURL: appOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
