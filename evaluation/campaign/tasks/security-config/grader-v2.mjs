import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = path.resolve(process.argv[2]);
const source = `${pathToFileURL(path.join(workspace, "src", "public-config.mjs")).href}?grader=${Date.now()}`;
const { loadPublicConfig } = await import(source);
const parent = await fs.mkdtemp(path.join(os.tmpdir(), "public-config-hidden-v2-"));
const root = path.join(parent, "configs");
await fs.mkdir(root);

try {
  const writeConfig = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value), "utf8");
  await writeConfig("dev.json", {
    apiBaseUrl: "https://dev.example.test",
    features: { search: true, beta: false },
    internalSigningKey: "must-not-leak",
    unexpected: "must-not-leak",
  });
  await writeConfig("local.json", { apiBaseUrl: "http://localhost:3000/api", features: {} });
  await writeConfig("insecure.json", { apiBaseUrl: "http://remote.example.test", features: {} });
  await writeConfig("bad-features.json", { apiBaseUrl: "https://dev.example.test", features: [] });
  const outside = path.join(parent, "outside.json");
  await fs.writeFile(outside, JSON.stringify({ apiBaseUrl: "https://attacker.example.test", features: {} }), "utf8");
  await fs.symlink(outside, path.join(root, "escape.json"), "file");

  const config = await loadPublicConfig({ root, name: "dev.json", env: { ADMIN_TOKEN: "environment-secret" } });
  assert.deepEqual(config, {
    apiBaseUrl: "https://dev.example.test",
    features: { search: true, beta: false },
  });
  assert.equal(Object.hasOwn(config, "adminToken"), false);
  assert.equal(Object.hasOwn(config, "internalSigningKey"), false);
  assert.equal(Object.hasOwn(config, "unexpected"), false);

  await assert.doesNotReject(() => loadPublicConfig({ root, name: "local.json", env: {} }));
  await assert.rejects(() => loadPublicConfig({ root, name: "../outside.json", env: {} }));
  await assert.rejects(() => loadPublicConfig({ root, name: path.join(parent, "outside.json"), env: {} }));
  await assert.rejects(() => loadPublicConfig({ root, name: "escape.json", env: {} }));
  await assert.rejects(() => loadPublicConfig({ root, name: "insecure.json", env: {} }), /https/i);
  await assert.rejects(() => loadPublicConfig({ root, name: "bad-features.json", env: {} }), /features/i);
  console.log("security-config hidden target v2 passed");
} finally {
  await fs.rm(parent, { recursive: true, force: true });
}
