import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeJobFile, JobStore } from "../src/job-store.mjs";

test("one worker can claim and complete a ready job", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-store-visible-"));
  const file = path.join(directory, "jobs.json");
  try {
    await initializeJobFile(file, ["job-1"]);
    const store = new JobStore(file, { now: () => 100 });
    const lease = await store.claim("worker-1", { lease_ms: 50 });
    assert.equal(lease.id, "job-1");
    assert.equal(lease.generation, 1);
    assert.equal(await store.complete("job-1", lease.token), true);
    assert.equal((await store.read()).jobs[0].status, "done");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
