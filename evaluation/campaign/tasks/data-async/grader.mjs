import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = path.resolve(process.argv[2]);
const source = `${pathToFileURL(path.join(workspace, "src", "job-store.mjs")).href}?grader=${Date.now()}`;
const { initializeJobFile, JobStore } = await import(source);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-store-hidden-"));
try {
  const concurrentFile = path.join(directory, "concurrent.json");
  await initializeJobFile(concurrentFile, ["shared"]);
  const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => new JobStore(concurrentFile, { now: () => 1_000 }).claim(`worker-${index}`, { lease_ms: 100 })));
  const winners = claims.filter(Boolean);
  assert.equal(winners.length, 1, "exactly one concurrent claimant must acquire the lease");
  const winner = winners[0];
  const winnerStore = new JobStore(concurrentFile, { now: () => 1_001 });
  assert.equal(await winnerStore.complete("shared", "forged-token"), false, "a stale or forged token must not complete work");
  assert.equal(await winnerStore.complete("shared", winner.token), true);

  let now = 10_000;
  const expiryFile = path.join(directory, "expiry.json");
  await initializeJobFile(expiryFile, ["expiring"]);
  const store = new JobStore(expiryFile, { now: () => now });
  const first = await store.claim("first", { lease_ms: 10 });
  now = 10_011;
  const second = await store.claim("second", { lease_ms: 10 });
  assert.equal(second.generation, first.generation + 1);
  assert.equal(await store.complete("expiring", first.token), false, "an expired generation must be fenced");
  assert.equal(await store.complete("expiring", second.token), true);
  console.log("data-async hidden target passed");
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
