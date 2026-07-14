#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "plugins", "agentic-delivery", "scripts", "install-project.mjs");

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: process.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else files.push(full);
  }
  return files;
}

async function hashes(directory) {
  const result = {};
  for (const file of await listFiles(directory)) {
    const relative = path.relative(directory, file).replaceAll("\\", "/");
    result[relative] = createHash("sha256").update(await fs.readFile(file)).digest("hex");
  }
  return result;
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-portability-"));
const target = path.join(temporaryRoot, "repository with spaces ü");
await fs.mkdir(target, { recursive: true });
try {
  const first = await runNode([installer, "--target", target, "--apply"], root);
  assert.equal(first.code, 0, first.stderr);
  const installed = await hashes(target);
  assert.equal(Object.keys(installed).length, 11, `expected 11 installed files, got ${Object.keys(installed).length}`);
  for (const required of [
    ".agentic/bin/agentic-harness.mjs",
    ".agentic/bin/sign-verifier-grant.mjs",
    ".agentic/config.json",
    ".agentic/tasks/TASK.template.json",
    ".agentic/verifier/README.md",
    "tests/e2e/support/agentic-evidence.mjs",
    "tests/e2e/support/agentic-reporter.mjs"
  ]) assert.ok(installed[required], `missing installed file ${required}`);

  const planFile = path.join(target, "docs", "exec-plans", "active", "PLAN.template.md");
  await fs.appendFile(planFile, "\nportable-preservation-sentinel\n", "utf8");
  const beforeReinstall = await hashes(target);
  const second = await runNode([installer, "--target", target, "--apply"], root);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /existing file\(s\) were preserved/);
  assert.deepEqual(await hashes(target), beforeReinstall, "reinstallation changed a preserved file");

  const harness = path.join(target, ".agentic", "bin", "agentic-harness.mjs");
  const doctor = await runNode([harness, "doctor", "--root", target], target);
  assert.equal(doctor.code, 0, doctor.stderr);
  assert.match(doctor.stdout, /PASS configuration/);
  const task = await runNode([harness, "validate-task", "--root", target, "--task", ".agentic/tasks/TASK.template.json"], target);
  assert.equal(task.code, 0, task.stderr);
  assert.match(task.stdout, /Valid task contract: BEAD-ID/);
  const installedTask = JSON.parse(await fs.readFile(path.join(target, ".agentic", "tasks", "TASK.template.json"), "utf8"));
  assert.equal(installedTask.schema_version, 3);
  assert.equal(installedTask.intake?.status, "ready");
  assert.deepEqual(installedTask.goal_spec?.acceptance_ids, ["AC-1"]);
  const goal = await runNode([harness, "goal-spec", "--root", target, "--task", ".agentic/tasks/TASK.template.json", "--json"], target);
  assert.equal(goal.code, 0, goal.stderr);
  const goalPayload = JSON.parse(goal.stdout);
  assert.equal(goalPayload.completion_target, "locally-verified");
  assert.match(goalPayload.intent_sha256, /^[a-f0-9]{64}$/);

  const plugin = JSON.parse(await fs.readFile(path.join(root, "plugins", "agentic-delivery", ".codex-plugin", "plugin.json"), "utf8"));
  const marketplace = JSON.parse(await fs.readFile(path.join(root, "marketplace.json"), "utf8"));
  const discoveredMarketplace = JSON.parse(await fs.readFile(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
  assert.equal(plugin.name, "agentic-delivery");
  assert.ok(marketplace.plugins.some((entry) => entry.name === plugin.name && entry.source?.path === "./plugins/agentic-delivery"));
  assert.ok(discoveredMarketplace.plugins.some((entry) => entry.name === plugin.name && entry.source?.path === "./plugins/agentic-delivery"));
  console.log(`PASS portability smoke on ${process.platform}/${process.arch} with ${Object.keys(installed).length} installed files`);
} finally {
  const temp = path.resolve(os.tmpdir());
  const resolved = path.resolve(temporaryRoot);
  if (!resolved.startsWith(`${temp}${path.sep}`) || !path.basename(resolved).startsWith("agentic-portability-")) throw new Error(`Refusing to remove unexpected temporary path ${resolved}`);
  await fs.rm(resolved, { recursive: true, force: true });
}
