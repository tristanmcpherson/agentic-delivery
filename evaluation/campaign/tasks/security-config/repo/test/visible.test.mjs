import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPublicConfig } from "../src/public-config.mjs";

test("loads the documented public configuration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "public-config-visible-"));
  try {
    await fs.writeFile(path.join(root, "dev.json"), JSON.stringify({ apiBaseUrl: "https://dev.example.test", features: { search: true } }), "utf8");
    const config = await loadPublicConfig({ root, name: "dev.json", env: {} });
    assert.equal(config.apiBaseUrl, "https://dev.example.test");
    assert.deepEqual(config.features, { search: true });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("missing configuration fails instead of inventing defaults", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "public-config-missing-"));
  try {
    await assert.rejects(() => loadPublicConfig({ root, name: "missing.json", env: {} }), /ENOENT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
