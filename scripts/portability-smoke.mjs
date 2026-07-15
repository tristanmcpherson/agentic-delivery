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
const installer = path.join(root, "plugins", "vision", "scripts", "install-project.mjs");

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
  assert.equal(Object.keys(installed).length, 21, `expected 21 installed files, got ${Object.keys(installed).length}`);
  for (const required of [
    ".agentic/bin/agentic.mjs",
    ".agentic/bin/agentic-harness.mjs",
    ".agentic/bin/agentic-lifecycle.mjs",
    ".agentic/bin/sign-verifier-grant.mjs",
    ".agentic/bin/sign-delivery-attestation.mjs",
    ".agentic/config.json",
    ".agentic/install-manifest.json",
    ".agentic/project-context.md",
    ".agentic/work-environment.md",
    ".agentic/tasks/TASK.template.json",
    ".agentic/verifier/README.md",
    ".codex/agents/agentic-scout.toml",
    ".codex/agents/agentic-builder.toml",
    ".codex/agents/agentic-gap-reviewer.toml",
    ".codex/agents/agentic-builder-reviewer.toml",
    "tests/e2e/support/agentic-evidence.mjs",
    "tests/e2e/support/agentic-reporter.mjs"
  ]) assert.ok(installed[required], `missing installed file ${required}`);

  const preview = await runNode([installer, "--target", target, "--json"], root);
  assert.equal(preview.code, 0, preview.stderr);
  const previewPayload = JSON.parse(preview.stdout);
  assert.equal(previewPayload.mode, "preview");
  assert.equal(previewPayload.counts.keep, 20);

  const planFile = path.join(target, "docs", "exec-plans", "active", "PLAN.template.md");
  const workEnvironmentFile = path.join(target, ".agentic", "work-environment.md");
  await fs.appendFile(planFile, "\nportable-preservation-sentinel\n", "utf8");
  await fs.appendFile(workEnvironmentFile, "\nteam-profile-preservation-sentinel\n", "utf8");
  const unmanagedFile = path.join(target, ".agentic", "user-owned.txt");
  await fs.writeFile(unmanagedFile, "user-owned\n", "utf8");
  const beforeReinstall = await hashes(target);
  const second = await runNode([installer, "--target", target, "--apply"], root);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /PRESERVE \.agentic\/work-environment\.md/);
  assert.match(second.stdout, /PRESERVE docs\/exec-plans\/active\/PLAN\.template\.md/);
  assert.match(second.stdout, /existing or modified file\(s\) were preserved/);
  assert.deepEqual(await hashes(target), beforeReinstall, "reinstallation changed a preserved file");

  const contextRelative = ".agentic/project-context.md";
  const contextFile = path.join(target, contextRelative);
  const oldManagedContent = "older-framework-owned-content\n";
  await fs.writeFile(contextFile, oldManagedContent, "utf8");
  const manifestFile = path.join(target, ".agentic", "install-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  const oldManagedHash = createHash("sha256").update(oldManagedContent).digest("hex");
  manifest.files[contextRelative].installed_sha256 = oldManagedHash;
  manifest.files[contextRelative].source_sha256 = oldManagedHash;
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const update = await runNode([installer, "--target", target, "--apply"], root);
  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /UPDATE \.agentic\/project-context\.md/);
  assert.equal(await fs.readFile(contextFile, "utf8"), await fs.readFile(path.join(root, "plugins", "vision", "assets", "project-template", contextRelative), "utf8"));
  assert.match(await fs.readFile(planFile, "utf8"), /portable-preservation-sentinel/);
  assert.match(await fs.readFile(workEnvironmentFile, "utf8"), /team-profile-preservation-sentinel/);
  assert.equal(await fs.readFile(unmanagedFile, "utf8"), "user-owned\n");

  const harness = path.join(target, ".agentic", "bin", "agentic-harness.mjs");
  const doctor = await runNode([harness, "doctor", "--root", target, "--json"], target);
  assert.equal(doctor.code, 0, doctor.stderr);
  const doctorPayload = JSON.parse(doctor.stdout);
  assert.equal(doctorPayload.overall, "pass");
  assert.ok(doctorPayload.checks.some((check) => check.name === "lifecycle controller" && check.status === "pass"));
  assert.ok(doctorPayload.checks.some((check) => check.name === "install ownership" && check.detail.includes("user-modified")));
  const task = await runNode([harness, "validate-task", "--root", target, "--task", ".agentic/tasks/TASK.template.json"], target);
  assert.equal(task.code, 0, task.stderr);
  assert.match(task.stdout, /Valid task contract: BEAD-ID/);
  const installedTask = JSON.parse(await fs.readFile(path.join(target, ".agentic", "tasks", "TASK.template.json"), "utf8"));
  assert.equal(installedTask.schema_version, 3);
  assert.equal(installedTask.risk_gate_version, 1);
  assert.equal(installedTask.intake?.status, "ready");
  assert.deepEqual(installedTask.goal_spec?.acceptance_ids, ["AC-1"]);
  const goal = await runNode([harness, "goal-spec", "--root", target, "--task", ".agentic/tasks/TASK.template.json", "--json"], target);
  assert.equal(goal.code, 0, goal.stderr);
  const goalPayload = JSON.parse(goal.stdout);
  assert.equal(goalPayload.completion_target, "locally-verified");
  assert.match(goalPayload.intent_sha256, /^[a-f0-9]{64}$/);

  const plugin = JSON.parse(await fs.readFile(path.join(root, "plugins", "vision", ".codex-plugin", "plugin.json"), "utf8"));
  const hooks = JSON.parse(await fs.readFile(path.join(root, "plugins", "vision", "hooks", "hooks.json"), "utf8"));
  const marketplace = JSON.parse(await fs.readFile(path.join(root, "marketplace.json"), "utf8"));
  const discoveredMarketplace = JSON.parse(await fs.readFile(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
  assert.equal(plugin.name, "vision");
  assert.ok(hooks.hooks.SessionStart?.length);
  assert.ok(hooks.hooks.PostCompact?.length);
  assert.ok(hooks.hooks.SubagentStart?.length);
  assert.ok(hooks.hooks.Stop?.length);
  assert.ok(marketplace.plugins.some((entry) => entry.name === plugin.name && entry.source?.path === "./plugins/vision"));
  assert.ok(discoveredMarketplace.plugins.some((entry) => entry.name === plugin.name && entry.source?.path === "./plugins/vision"));

  const uninstall = await runNode([installer, "--target", target, "--uninstall", "--apply", "--json"], root);
  assert.equal(uninstall.code, 0, uninstall.stderr);
  const uninstallPayload = JSON.parse(uninstall.stdout);
  assert.ok(uninstallPayload.counts.remove >= 18);
  assert.equal(uninstallPayload.counts.preserve, 2);
  assert.ok(await fs.stat(planFile));
  assert.ok(await fs.stat(workEnvironmentFile));
  assert.ok(await fs.stat(unmanagedFile));
  await assert.rejects(fs.stat(harness));
  const remainingManifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  assert.deepEqual(Object.keys(remainingManifest.files), [".agentic/work-environment.md", "docs/exec-plans/active/PLAN.template.md"]);
  console.log(`PASS portability smoke on ${process.platform}/${process.arch} with ${Object.keys(installed).length} installed files`);
} finally {
  const temp = path.resolve(os.tmpdir());
  const resolved = path.resolve(temporaryRoot);
  if (!resolved.startsWith(`${temp}${path.sep}`) || !path.basename(resolved).startsWith("agentic-portability-")) throw new Error(`Refusing to remove unexpected temporary path ${resolved}`);
  await fs.rm(resolved, { recursive: true, force: true });
}
