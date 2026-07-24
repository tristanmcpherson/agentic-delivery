import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = path.resolve(process.argv[2]);
const source = `${pathToFileURL(path.join(workspace, "src", "public-config.mjs")).href}?grader=${Date.now()}`;
const { loadPublicConfig } = await import(source);
const parent = await fs.mkdtemp(path.join(os.tmpdir(), "public-config-hidden-"));
const root = path.join(parent, "configs");
await fs.mkdir(root);
try {
  await fs.writeFile(path.join(root, "dev.json"), JSON.stringify({
    apiBaseUrl: "https://dev.example.test",
    features: { search: true, beta: false },
    internalSigningKey: "must-not-leak",
    unexpected: "must-not-leak",
  }), "utf8");
  await fs.writeFile(path.join(parent, "outside.json"), JSON.stringify({ apiBaseUrl: "https://attacker.example.test", features: {} }), "utf8");
  await fs.writeFile(path.join(root, "insecure.json"), JSON.stringify({ apiBaseUrl: "http://remote.example.test", features: {} }), "utf8");

  const config = await loadPublicConfig({ root, name: "dev.json", env: { ADMIN_TOKEN: "environment-secret" } });
  assert.deepEqual(config, {
    apiBaseUrl: "https://dev.example.test",
    features: { search: true, beta: false },
  });
  assert.equal(Object.hasOwn(config, "adminToken"), false);
  assert.equal(Object.hasOwn(config, "internalSigningKey"), false);
  assert.equal(Object.hasOwn(config, "unexpected"), false);
  await assert.rejects(() => loadPublicConfig({ root, name: "../outside.json", env: {} }), /invalid configuration name/i);
  await assert.rejects(() => loadPublicConfig({ root, name: path.join(parent, "outside.json"), env: {} }), /invalid configuration name/i);
  await assert.rejects(() => loadPublicConfig({ root, name: "insecure.json", env: {} }), /https/i);
  console.log("security-config hidden target passed");
} finally {
  await fs.rm(parent, { recursive: true, force: true });
}
