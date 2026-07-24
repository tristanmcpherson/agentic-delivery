import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { buildHarnessDoctorReport } from "../plugins/vision/scripts/harness-doctor.mjs";

async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

function skill(name, description, body = "State the outcome, evidence, permission boundary, and stop condition.") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

test("project inventory distinguishes conflicts, historical fixtures, and owned drift", async (t) => {
  // Given: operational and historical skills plus an ownership manifest with hostile entries.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-project-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(path.join(root, ".agents", "skills", "alpha", "SKILL.md"), skill("alpha", "Primary audit workflow."));
  await write(path.join(root, "packages", "api", ".agents", "skills", "alpha", "SKILL.md"), skill("alpha", "Conflicting operational workflow."));
  const mirrorSkill = skill("mirror", "Byte-identical mirrored workflow.");
  await write(path.join(root, ".agents", "skills", "mirror", "SKILL.md"), mirrorSkill);
  await write(path.join(root, "packages", "api", ".agents", "skills", "mirror", "SKILL.md"), mirrorSkill);
  await write(path.join(root, "evaluation", "fixtures", ".agents", "skills", "alpha", "SKILL.md"), skill("alpha", "Historical baseline workflow."));
  await write(path.join(root, ".agents", "skills", "broken", "SKILL.md"), "---\nname: broken\n---\n\nNo contract.\n");
  const current = "framework-current\n";
  const installedModified = "framework-installed\n";
  await write(path.join(root, ".agentic", "bin", "current.mjs"), current);
  await write(path.join(root, ".agentic", "bin", "modified.mjs"), "user-modified\n");
  await write(path.join(root, ".agentic", "config.json"), "{\"schema_version\":2}\n");
  await write(path.join(root, ".codex", "agents", "reviewer.toml"), "model = \"gpt-5.6-sol\"\nmodel_reasoning_effort = \"max\"\n");
  await write(path.join(root, "evaluation", "baselines", "legacy.toml"), "model = \"gpt-5.4\"\n");
  await write(path.join(root, "evaluation", "fixtures", "old-plugin", ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "historical-plugin", version: "0.1.0", skills: "./missing-skills/",
  })}\n`);
  await write(path.join(root, "packages", "sample-plugin", ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "sample-plugin", version: "1.0.0", mcpServers: "./missing-mcp.json",
  })}\n`);
  await write(path.join(root, ".agentic", "install-manifest.json"), `${JSON.stringify({
    schema_version: 1,
    owner: "vision",
    files: {
      ".agentic/bin/current.mjs": { installed_sha256: hash(current) },
      ".agentic/bin/modified.mjs": { installed_sha256: hash(installedModified) },
      "../outside.txt": { installed_sha256: hash("outside") },
    },
  }, null, 2)}\n`);

  // When: project scope is inventoried twice.
  const first = await buildHarnessDoctorReport({ root, scope: "project", codexCommand: "__missing_codex__" });
  const second = await buildHarnessDoctorReport({ root, scope: "project", codexCommand: "__missing_codex__" });

  // Then: output is stable and unsafe or ambiguous states stay advisory.
  assert.deepEqual(second, first);
  assert.equal(first.inventory.skills.length, 6);
  assert.equal(first.inventory.skills.find((item) => item.path.includes("evaluation"))?.context, "historical");
  assert.equal(first.inventory.harness.find((item) => item.path.endsWith("current.mjs"))?.ownership, "framework-owned-current");
  assert.equal(first.inventory.harness.find((item) => item.path.endsWith("modified.mjs"))?.ownership, "framework-owned-modified");
  assert.ok(first.findings.some((item) => item.code === "duplicate-skill-candidate" && item.recommendation === "manual-review"));
  assert.ok(!first.findings.some((item) => item.code === "duplicate-skill-candidate" && item.rationale.includes("mirror")));
  assert.ok(first.findings.some((item) => item.code === "malformed-skill-metadata" && item.recommendation === "update"));
  assert.ok(first.findings.some((item) => item.code === "manifest-path-escape" && item.recommendation === "manual-review"));
  assert.ok(first.findings.some((item) => item.code === "modified-framework-file" && item.recommendation === "retain"));
  assert.ok(first.findings.some((item) => item.code === "role-model-pin"));
  assert.ok(first.findings.some((item) => item.code === "max-reasoning-effort"));
  assert.ok(first.inventory.model_references.some((item) => item.context === "historical" && item.model === "gpt-5.4"));
  assert.equal(first.inventory.plugins.find((item) => item.name === "historical-plugin")?.context, "historical");
  assert.ok(!first.findings.some((item) => item.code === "missing-declared-component" && item.evidence.some((value) => value.includes("old-plugin"))));
  assert.ok(first.findings.some((item) => item.code === "missing-declared-component" && item.evidence.some((value) => value.includes("sample-plugin"))));
  assert.equal(first.inventory.tools[0].status, "unknown");
});

test("project inventory records an external skill symlink without following it", async (t) => {
  if (process.platform === "win32") return t.skip("file symlinks require host policy on Windows");
  // Given: a project skill path pointing outside the project.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-link-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-outside-"));
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
  await write(path.join(outside, "SKILL.md"), skill("outside", "External workflow."));
  await fs.mkdir(path.join(root, ".agents", "skills"), { recursive: true });
  await fs.symlink(outside, path.join(root, ".agents", "skills", "outside"), "dir");

  // When: the project is audited.
  const report = await buildHarnessDoctorReport({ root, scope: "project", codexCommand: "__missing_codex__" });

  // Then: the target is not trusted as an owned project skill.
  assert.equal(report.inventory.skills[0].status, "symlink");
  assert.equal(report.inventory.skills[0].ownership, "unowned");
  assert.ok(report.findings.some((item) => item.code === "external-skill-symlink" && item.confirmation_required));
});

test("a plugin-declared skill root cannot gain ownership through an escaping link", async (t) => {
  // Given: a lexically contained plugin skill root that resolves outside the plugin.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-plugin-link-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-plugin-outside-"));
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
  const plugin = path.join(root, "plugins", "demo");
  await write(path.join(plugin, ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "demo",
    version: "1.0.0",
    skills: "./skills/",
  })}\n`);
  await write(path.join(outside, "external", "SKILL.md"), skill("external", "Externally owned workflow."));
  await fs.symlink(outside, path.join(plugin, "skills"), process.platform === "win32" ? "junction" : "dir");

  // When: the repository is audited.
  const report = await buildHarnessDoctorReport({ root, scope: "project", codexCommand: "__missing_codex__" });

  // Then: the external target is neither traversed nor described as plugin-owned.
  assert.ok(report.findings.some((item) => item.code === "declared-component-path-escape"));
  assert.ok(!report.inventory.skills.some((item) => item.name === "external" && item.ownership === "plugin-owned"));
});

test("an install-manifest path cannot gain ownership through an escaping parent link", async (t) => {
  // Given: a manifest entry whose parent is linked outside the audited project.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-manifest-link-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-manifest-outside-"));
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
  const content = "external-owned\n";
  await write(path.join(outside, "external.mjs"), content);
  await fs.mkdir(path.join(root, ".agentic"), { recursive: true });
  await fs.symlink(outside, path.join(root, ".agentic", "bin"), process.platform === "win32" ? "junction" : "dir");
  await write(path.join(root, ".agentic", "install-manifest.json"), `${JSON.stringify({
    schema_version: 1,
    owner: "vision",
    files: { ".agentic/bin/external.mjs": { installed_sha256: hash(content) } },
  })}\n`);

  // When: manifest ownership is audited.
  const report = await buildHarnessDoctorReport({ root, scope: "project", codexCommand: "__missing_codex__" });

  // Then: resolved containment wins over the lexical manifest path.
  assert.ok(report.findings.some((item) => item.code === "manifest-resolved-path-escape"));
  assert.equal(report.inventory.harness.find((item) => item.relative === ".agentic/bin/external.mjs")?.ownership, "unowned");
});
