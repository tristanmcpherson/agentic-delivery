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
  assert.equal(Object.keys(installed).length, 35, `expected 35 installed files, got ${Object.keys(installed).length}`);
  for (const required of [
    ".vision/bin/agentic.mjs",
    ".vision/bin/agentic-harness.mjs",
    ".vision/bin/execution-graph.mjs",
    ".vision/bin/agentic-lifecycle.mjs",
    ".vision/bin/harness-doctor.mjs",
    ".vision/bin/harness-doctor-config.mjs",
    ".vision/bin/harness-doctor-models.mjs",
    ".vision/bin/harness-doctor-plugins.mjs",
    ".vision/bin/harness-doctor-project.mjs",
    ".vision/bin/harness-doctor-skills.mjs",
    ".vision/bin/harness-doctor-utils.mjs",
    ".vision/bin/lifecycle-model.mjs",
    ".vision/bin/lifecycle-state-store.mjs",
    ".vision/bin/campaign-core.mjs",
    ".vision/bin/campaign-report.mjs",
    ".vision/bin/vision-campaign.mjs",
    ".vision/bin/vision-manager.mjs",
    ".vision/bin/sign-verifier-grant.mjs",
    ".vision/bin/sign-delivery-attestation.mjs",
    ".vision/config.json",
    ".vision/install-manifest.json",
    ".vision/project-context.md",
    ".vision/work-environment.md",
    ".vision/tasks/TASK.template.json",
    ".vision/verifier/README.md",
    ".codex/agents/agentic-scout.toml",
    ".codex/agents/agentic-builder.toml",
    ".codex/agents/agentic-gap-reviewer.toml",
    ".codex/agents/agentic-builder-reviewer.toml",
    "tests/e2e/support/agentic-evidence.mjs",
    "tests/e2e/support/agentic-reporter.mjs"
  ]) assert.ok(installed[required], `missing installed file ${required}`);

  for (const role of [
    ".codex/agents/agentic-scout.toml",
    ".codex/agents/agentic-builder.toml",
    ".codex/agents/agentic-gap-reviewer.toml",
    ".codex/agents/agentic-builder-reviewer.toml"
  ]) {
    const profile = await fs.readFile(path.join(target, role), "utf8");
    assert.doesNotMatch(profile, /^model_reasoning_effort\s*=/m, `${role} should inherit the repository's evaluated reasoning baseline`);
  }

  const preview = await runNode([installer, "--target", target, "--json"], root);
  assert.equal(preview.code, 0, preview.stderr);
  const previewPayload = JSON.parse(preview.stdout);
  assert.equal(previewPayload.mode, "preview");
  assert.equal(previewPayload.counts.keep, Object.keys(installed).length - 1, "preview should keep every installed payload file");

  const planFile = path.join(target, "docs", "exec-plans", "active", "PLAN.template.md");
  const workEnvironmentFile = path.join(target, ".vision", "work-environment.md");
  await fs.appendFile(planFile, "\nportable-preservation-sentinel\n", "utf8");
  await fs.appendFile(workEnvironmentFile, "\nteam-profile-preservation-sentinel\n", "utf8");
  const unmanagedFile = path.join(target, ".vision", "user-owned.txt");
  await fs.writeFile(unmanagedFile, "user-owned\n", "utf8");
  const beforeReinstall = await hashes(target);
  const second = await runNode([installer, "--target", target, "--apply"], root);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /PRESERVE \.vision\/work-environment\.md/);
  assert.match(second.stdout, /PRESERVE docs\/exec-plans\/active\/PLAN\.template\.md/);
  assert.match(second.stdout, /existing or modified file\(s\) were preserved/);
  assert.deepEqual(await hashes(target), beforeReinstall, "reinstallation changed a preserved file");

  const contextRelative = ".vision/project-context.md";
  const contextFile = path.join(target, contextRelative);
  const oldManagedContent = "older-framework-owned-content\n";
  await fs.writeFile(contextFile, oldManagedContent, "utf8");
  const manifestFile = path.join(target, ".vision", "install-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  const oldManagedHash = createHash("sha256").update(oldManagedContent).digest("hex");
  manifest.files[contextRelative].installed_sha256 = oldManagedHash;
  manifest.files[contextRelative].source_sha256 = oldManagedHash;
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const update = await runNode([installer, "--target", target, "--apply"], root);
  assert.equal(update.code, 0, update.stderr);
  assert.match(update.stdout, /UPDATE \.vision\/project-context\.md/);
  assert.equal(await fs.readFile(contextFile, "utf8"), await fs.readFile(path.join(root, "plugins", "vision", "assets", "project-template", contextRelative), "utf8"));
  assert.match(await fs.readFile(planFile, "utf8"), /portable-preservation-sentinel/);
  assert.match(await fs.readFile(workEnvironmentFile, "utf8"), /team-profile-preservation-sentinel/);
  assert.equal(await fs.readFile(unmanagedFile, "utf8"), "user-owned\n");

  const harness = path.join(target, ".vision", "bin", "agentic-harness.mjs");
  const lifecycle = path.join(target, ".vision", "bin", "agentic-lifecycle.mjs");
  const lifecycleHelp = await runNode([lifecycle, "--help"], target);
  assert.equal(lifecycleHelp.code, 0, lifecycleHelp.stderr);
  assert.match(lifecycleHelp.stdout, /lease/);
  const visionCli = path.join(target, ".vision", "bin", "agentic.mjs");
  const visionHelp = await runNode([visionCli, "--help"], target);
  assert.equal(visionHelp.code, 0, visionHelp.stderr);
  assert.match(visionHelp.stdout, /campaign/);
  const campaign = path.join(target, ".vision", "bin", "vision-campaign.mjs");
  const campaignHelp = await runNode([campaign, "--help"], target);
  assert.equal(campaignHelp.code, 0, campaignHelp.stderr);
  assert.match(campaignHelp.stdout, /preflight/);
  const harnessDoctor = await runNode([visionCli, "harness-doctor", "--root", target, "--scope", "project", "--codex-command", "__missing_codex__", "--json"], target);
  assert.equal(harnessDoctor.code, 0, harnessDoctor.stderr);
  const harnessDoctorPayload = JSON.parse(harnessDoctor.stdout);
  assert.equal(harnessDoctorPayload.mode, "diagnostic-read-only");
  assert.equal(harnessDoctorPayload.subject.kind, "installed-project");
  const doctor = await runNode([harness, "doctor", "--root", target, "--json"], target);
  assert.equal(doctor.code, 0, doctor.stderr);
  const doctorPayload = JSON.parse(doctor.stdout);
  assert.equal(doctorPayload.overall, "pass");
  assert.ok(doctorPayload.checks.some((check) => check.name === "lifecycle controller" && check.status === "pass"));
  assert.ok(doctorPayload.checks.some((check) => check.name === "install ownership" && check.detail.includes("user-modified")));
  const task = await runNode([harness, "validate-task", "--root", target, "--task", ".vision/tasks/TASK.template.json"], target);
  assert.equal(task.code, 0, task.stderr);
  assert.match(task.stdout, /Valid task contract: BEAD-ID/);
  const installedTask = JSON.parse(await fs.readFile(path.join(target, ".vision", "tasks", "TASK.template.json"), "utf8"));
  assert.equal(installedTask.schema_version, 3);
  assert.equal(installedTask.risk_gate_version, 1);
  assert.equal(installedTask.intake?.status, "ready");
  assert.deepEqual(installedTask.goal_spec?.acceptance_ids, ["AC-1"]);
  const goal = await runNode([harness, "goal-spec", "--root", target, "--task", ".vision/tasks/TASK.template.json", "--json"], target);
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
  assert.ok(hooks.hooks.UserPromptSubmit?.length);
  assert.ok(hooks.hooks.Stop?.length);
  assert.ok(marketplace.plugins.some((entry) => entry.name === plugin.name && entry.source?.path === "./plugins/vision"));
  assert.ok(discoveredMarketplace.plugins.some((entry) => entry.name === plugin.name && entry.source?.path === "./plugins/vision"));

  const uninstall = await runNode([installer, "--target", target, "--uninstall", "--apply", "--json"], root);
  assert.equal(uninstall.code, 0, uninstall.stderr);
  const uninstallPayload = JSON.parse(uninstall.stdout);
  assert.ok(uninstallPayload.counts.remove >= 29);
  assert.equal(uninstallPayload.counts.preserve, 2);
  assert.ok(await fs.stat(planFile));
  assert.ok(await fs.stat(workEnvironmentFile));
  assert.ok(await fs.stat(unmanagedFile));
  await assert.rejects(fs.stat(harness));
  const remainingManifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  assert.deepEqual(Object.keys(remainingManifest.files), [".vision/work-environment.md", "docs/exec-plans/active/PLAN.template.md"]);
  console.log(`PASS portability smoke on ${process.platform}/${process.arch} with ${Object.keys(installed).length} installed files`);
} finally {
  const temp = path.resolve(os.tmpdir());
  const resolved = path.resolve(temporaryRoot);
  if (!resolved.startsWith(`${temp}${path.sep}`) || !path.basename(resolved).startsWith("agentic-portability-")) throw new Error(`Refusing to remove unexpected temporary path ${resolved}`);
  await fs.rm(resolved, { recursive: true, force: true });
}
