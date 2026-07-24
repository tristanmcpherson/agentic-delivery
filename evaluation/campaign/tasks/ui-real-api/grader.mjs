import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const workspace = path.resolve(process.argv[2]);
const serverModule = `${pathToFileURL(path.join(workspace, "server.mjs")).href}?grader=${Date.now()}`;
const { createApplicationServer } = await import(serverModule);
const server = createApplicationServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const responses = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/orders")) responses.push({ url: response.url(), status: response.status() });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator("#app[aria-busy='false']").waitFor();
  await assert.doesNotReject(() => page.getByText("Order A-100 — $12.34", { exact: true }).waitFor({ timeout: 2_000 }));
  await assert.doesNotReject(() => page.getByText("Order B-200 — $50.99", { exact: true }).waitFor({ timeout: 2_000 }));
  const state = await page.locator("#app").evaluate((element) => ({ nonce: element.dataset.requestNonce, text: element.textContent }));
  assert.ok(state.nonce);
  assert.doesNotMatch(state.text, /undefined|NaN/);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 200);
  assert.equal(new URL(responses[0].url).searchParams.get("nonce"), state.nonce);
  console.log("ui-real-api hidden target passed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
