import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "test";
}

function sameOrigin(url, origin) {
  if (!origin) return false;
  try { return new URL(url).origin === new URL(origin).origin; } catch { return false; }
}

function targetsOrigin(pattern, origin) {
  if (!origin || typeof pattern !== "string") return false;
  return pattern.includes(new URL(origin).origin);
}

function selectedHeaders(headers, names) {
  return Object.fromEntries(names.map((name) => [name, headers[name]]).filter(([, value]) => value !== undefined));
}

export const test = base.extend({
  agenticEvidence: [async ({ page, context }, use, testInfo) => {
    const apiOrigin = process.env.AGENTIC_API_ORIGIN || "";
    const appOrigin = process.env.AGENTIC_APP_ORIGIN || "";
    const markerHeader = (process.env.AGENTIC_EXPECTED_MARKER_HEADER || "").toLowerCase();
    const markerValue = process.env.AGENTIC_EXPECTED_MARKER_VALUE || "";
    const attestationDir = process.env.AGENTIC_ATTESTATION_DIR || path.resolve("test-results", "agentic-attestations");
    const artifactDir = process.env.AGENTIC_ARTIFACT_DIR || path.resolve("test-results", "agentic-artifacts");
    const apiResponses = [];
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const screenshots = [];
    let firstPartyMocked = false;
    const runNonce = process.env.AGENTIC_RUN_NONCE || "";
    if (runNonce) await context.setExtraHTTPHeaders({ "x-agentic-run-id": runNonce });

    const originalPageRoute = page.route.bind(page);
    page.route = async (pattern, ...args) => {
      if (targetsOrigin(pattern, apiOrigin)) firstPartyMocked = true;
      return originalPageRoute(pattern, ...args);
    };
    const originalRouteFromHar = page.routeFromHAR.bind(page);
    page.routeFromHAR = async (...args) => {
      firstPartyMocked = true;
      return originalRouteFromHar(...args);
    };

    page.on("response", (response) => {
      if (!sameOrigin(response.url(), apiOrigin)) return;
      const request = response.request();
      const requestHeaders = request.headers();
      const responseHeaders = response.headers();
      apiResponses.push({
        url: response.url(),
        method: request.method(),
        post_data: request.postData() || null,
        redirected_from: request.redirectedFrom()?.url() || null,
        request_headers: selectedHeaders(requestHeaders, ["accept", "content-type", "x-agentic-run-id"]),
        status: response.status(),
        headers: selectedHeaders(responseHeaders, ["content-type", markerHeader, "x-agentic-run-id", "x-agentic-request-id", "x-agentic-deployment-id", "x-agentic-response-sha256"])
      });
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() });
    });
    page.on("pageerror", (error) => pageErrors.push({ message: error.message, stack: error.stack || null }));
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), method: request.method(), failure: request.failure() }));

    const evidence = {
      markFirstPartyMocked() { firstPartyMocked = true; },
      async checkpoint(name) {
        await fs.mkdir(artifactDir, { recursive: true });
        const file = path.resolve(artifactDir, `${slug(testInfo.project.name)}-${slug(testInfo.title)}-${slug(name)}.png`);
        await page.screenshot({ path: file, fullPage: true });
        screenshots.push(file);
        return file;
      },
    };

    await use(evidence);

    try {
      await fs.mkdir(artifactDir, { recursive: true });
      const finalImage = path.resolve(artifactDir, `${slug(testInfo.project.name)}-${slug(testInfo.title)}-final.png`);
      await page.screenshot({ path: finalImage, fullPage: true });
      screenshots.push(finalImage);
    } catch (error) {
      pageErrors.push({ message: `final screenshot failed: ${error.message}`, stack: null });
    }

    const attestation = {
      schema_version: 1,
      task_id: process.env.AGENTIC_TASK_ID || null,
      check_id: process.env.AGENTIC_CHECK_ID || null,
      profile: process.env.AGENTIC_PROFILE || null,
      run_nonce_sha256: runNonce ? createHash("sha256").update(runNonce).digest("hex") : null,
      test: { title: testInfo.title, project: testInfo.project.name, status: testInfo.status },
      page_url: page.url(),
      expected: {
        app_origin: appOrigin,
        api_origin: apiOrigin,
        mock_policy: process.env.AGENTIC_MOCK_POLICY || null,
        marker: markerHeader ? { header: markerHeader, value: markerValue } : null
      },
      first_party_mocked: firstPartyMocked,
      api_responses: apiResponses,
      console_errors: consoleErrors,
      page_errors: pageErrors,
      failed_requests: failedRequests,
      screenshots
    };
    await fs.mkdir(attestationDir, { recursive: true });
    const attestationFile = path.join(attestationDir, `${slug(testInfo.project.name)}-${slug(testInfo.title)}.json`);
    await fs.writeFile(attestationFile, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
    await testInfo.attach("agentic-runtime-attestation", { body: Buffer.from(JSON.stringify(attestation, null, 2)), contentType: "application/json" });
  }, { auto: true }]
});

export { expect };
