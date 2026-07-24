import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const visionCli = path.join(repositoryRoot, "plugins", "vision", "scripts", "agentic.mjs");

function runVision(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [visionCli, ...args], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

test("harness-doctor emits a deterministic read-only project report", async (t) => {
  // Given: a project with one valid repository skill.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const skill = path.join(root, ".agents", "skills", "example");
  await fs.mkdir(skill, { recursive: true });
  await fs.writeFile(path.join(skill, "SKILL.md"), [
    "---",
    "name: example",
    "description: Audit one example surface.",
    "---",
    "",
    "Return evidence and stop when the audit is complete.",
    "Return evidence and stop when the audit is complete.",
    "",
  ].join("\n"), "utf8");

  // When: the command is invoked in its default project scope.
  const result = await runVision(["harness-doctor", "--root", root, "--json"], root);

  // Then: it succeeds with the versioned diagnostic contract and makes no writes.
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, 1);
  assert.equal(report.mode, "diagnostic-read-only");
  assert.equal(report.scope, "project");
  assert.equal(report.subject.root, path.resolve(root));
  assert.equal(report.inventory.skills.length, 1);
  assert.equal(report.inventory.skills[0].name, "example");
  assert.equal(report.inventory.skills[0].status, "valid");
  assert.equal(report.inventory.skills[0].prompt_contract.permissions, false);
  assert.deepEqual(report.inventory.skills[0].prompt_contract.repeated_instructions, ["Return evidence and stop when the audit is complete."]);
  assert.ok(!report.findings.some((item) => item.code === "prompt-contract-gap"));
  assert.ok(!report.findings.some((item) => item.code === "repeated-prompt-instruction"));
  assert.deepEqual((await fs.readdir(root)).sort(), [".agents"]);
});

test("harness-doctor keeps human and JSON summaries aligned and uses stable exit classes", async (t) => {
  // Given: a clean project and an integrity-violating install manifest.
  const clean = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-parity-"));
  const unsafe = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-fail-"));
  t.after(() => Promise.all([fs.rm(clean, { recursive: true, force: true }), fs.rm(unsafe, { recursive: true, force: true })]));
  await fs.mkdir(path.join(unsafe, ".agentic"), { recursive: true });
  await fs.writeFile(path.join(unsafe, ".agentic", "install-manifest.json"), `${JSON.stringify({
    schema_version: 1,
    owner: "vision",
    files: { "../outside": { installed_sha256: "0".repeat(64) } },
  })}\n`, "utf8");

  // When: both renderers and invalid/failing cases run.
  const json = await runVision(["harness-doctor", "--root", clean, "--codex-command", "__missing_codex__", "--json"], clean);
  const human = await runVision(["harness-doctor", "--root", clean, "--codex-command", "__missing_codex__"], clean);
  const invalid = await runVision(["harness-doctor", "--scope", "invalid"], clean);
  const integrity = await runVision(["harness-doctor", "--root", unsafe, "--codex-command", "__missing_codex__", "--json"], unsafe);

  // Then: the same summary drives both views and exit 1 differs from usage exit 2.
  const payload = JSON.parse(json.stdout);
  assert.equal(json.code, 0);
  assert.equal(human.code, 0);
  assert.match(human.stdout, new RegExp(`Skills ${payload.summary.inventory.skills} \\| Plugins ${payload.summary.inventory.plugins} \\| Harness ${payload.summary.inventory.harness} \\| Findings ${payload.findings.length}`));
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Invalid scope/);
  assert.equal(integrity.code, 1);
  assert.equal(JSON.parse(integrity.stdout).summary.overall, "fail");
});

test("the published report schema and plugin package discover both focused skills", async () => {
  // Given: the checked-in plugin manifest, skill roots, and report schema.
  const pluginRoot = path.join(repositoryRoot, "plugins", "vision");
  const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const schema = JSON.parse(await fs.readFile(path.join(pluginRoot, "references", "harness-doctor-report.schema.json"), "utf8"));
  const skillsRoot = path.resolve(pluginRoot, manifest.skills);

  // When: package discovery follows the declared skill directory.
  const skillDirectories = (await fs.readdir(skillsRoot, { withFileTypes: true }))
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();

  // Then: the two skills and versioned machine contract are explicit.
  assert.deepEqual(skillDirectories, ["harness-doctor", "vision"]);
  assert.equal(schema.properties.schema_version.const, 1);
  assert.equal(schema.properties.mode.const, "diagnostic-read-only");
  assert.ok(schema.required.includes("semantic_review"));
  assert.deepEqual(schema.properties.findings.items.properties.recommendation.enum, [
    "retain", "update", "add", "disable", "remove-preview", "manual-review",
  ]);
});
