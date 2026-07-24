import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildHarnessDoctorReport } from "../plugins/vision/scripts/harness-doctor.mjs";

async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

test("user inventory separates installed state, materialized paths, and disabled skills", async (t) => {
  // Given: a Codex home with one enabled plugin, one disabled skill, and expected materialization.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-user-root-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-user-home-"));
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(codexHome, { recursive: true, force: true })]));
  const plugin = path.join(codexHome, "plugins", "cache", "local", "demo", "1.0.0");
  const passivePlugin = path.join(codexHome, "plugins", "cache", "local", "passive", "1.0.0");
  const marketplace = path.join(codexHome, "marketplace-fixture");
  const disabledSkill = path.join(codexHome, "skills", "disabled", "SKILL.md");
  await write(disabledSkill, "---\nname: disabled\ndescription: Disabled workflow.\n---\n");
  await write(path.join(plugin, ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "demo",
    version: "1.0.0",
    description: "Demo plugin",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  }, null, 2)}\n`);
  await write(path.join(plugin, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo workflow.\n---\n");
  await write(path.join(passivePlugin, ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "passive",
    version: "1.0.0",
    skills: "./skills/",
  })}\n`);
  await write(path.join(passivePlugin, "skills", "passive", "SKILL.md"), "---\nname: passive\ndescription: Passive cached workflow.\n---\n");
  await write(path.join(plugin, "dist", "server.mjs"), "export {};\n");
  await write(path.join(plugin, ".mcp.json"), `${JSON.stringify({
    mcpServers: { demo: { command: path.join(plugin, "dist", "server.mjs") } },
  }, null, 2)}\n`);
  await write(path.join(marketplace, ".agents", "plugins", "marketplace.json"), `${JSON.stringify({
    name: "fixture-marketplace",
    plugins: [{ name: "available-only", source: { source: "path", path: "./plugins/available-only" } }],
  }, null, 2)}\n`);
  await write(path.join(codexHome, "config.toml"), [
    "model = \"gpt-5.6-terra\"",
    "model_reasoning_effort = \"high\"",
    "[notice.model_migrations]",
    "\"gpt-5.4\" = \"gpt-5.6\"",
    "[[skills.config]]",
    `path = ${JSON.stringify(disabledSkill.replaceAll("\\", "/"))}`,
    "enabled = false",
    "[plugins.\"demo@local\"]",
    "enabled = true",
    "[plugins.\"ghost@local\"]",
    "enabled = true",
    "[marketplaces.fixture]",
    `source = ${JSON.stringify(marketplace.replaceAll("\\", "/"))}`,
    "[marketplaces.remote]",
    "source = \"https://token:secret@example.invalid/catalog?key=secret#fragment\"",
    "",
  ].join("\n"));

  // When: user scope is inventoried offline.
  const report = await buildHarnessDoctorReport({ root, codexHome, scope: "user", codexCommand: "__missing_codex__" });

  // Then: installed/enabled and disabled state are explicit without false drift.
  assert.equal(report.inventory.plugins.find((item) => item.name === "demo")?.installation, "installed");
  assert.equal(report.inventory.plugins.find((item) => item.name === "demo")?.enabled, true);
  assert.equal(report.inventory.plugins.find((item) => item.name === "passive")?.enabled, null);
  assert.equal(report.inventory.plugins.find((item) => item.name === "ghost")?.installation, "configured");
  assert.equal(report.inventory.plugins.find((item) => item.name === "ghost")?.status, "not-installed");
  assert.equal(report.inventory.plugins.some((item) => item.name === "available-only"), false);
  assert.ok(report.inventory.marketplaces.some((item) => item.plugins.some((pluginEntry) => pluginEntry.name === "available-only")));
  const remoteMarketplace = report.inventory.marketplaces.find((item) => item.configured_as === "remote");
  assert.equal(remoteMarketplace.status, "configured-remote-unqueried");
  assert.ok(!remoteMarketplace.path.includes("token"));
  assert.ok(!remoteMarketplace.path.includes("secret"));
  assert.ok(!remoteMarketplace.path.includes("key="));
  assert.equal(report.inventory.skills.find((item) => item.name === "disabled")?.enabled, false);
  assert.equal(report.inventory.skills.find((item) => item.name === "demo")?.source, "plugin");
  assert.equal(report.inventory.skills.find((item) => item.name === "passive")?.enabled, null);
  assert.equal(report.inventory.model_references.find((item) => item.model === "gpt-5.6-terra")?.role, "configured-default");
  assert.ok(!report.findings.some((item) => item.code === "gpt56-update-candidate" && item.evidence.includes(report.sources.find((item) => item.kind === "codex-config").path)));
  assert.ok(report.findings.some((item) => item.code === "codex-tool-unavailable" && item.status === "unknown"));
  assert.ok(report.findings.some((item) => item.code === "enabled-plugin-not-installed" && item.status === "unknown"));
  assert.ok(!report.findings.some((item) => item.code === "missing-declared-component"));
  assert.ok(report.sources.some((item) => item.kind === "codex-config" && item.status === "read"));
});

test("user inventory labels user, admin, system, plugin, and declared dependency provenance", async (t) => {
  // Given: each supported non-project skill root contains one uniquely named skill.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-scope-root-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-scope-home-"));
  const admin = await fs.mkdtemp(path.join(os.tmpdir(), "vision-harness-doctor-admin-"));
  const system = path.join(codexHome, "skills", ".system");
  t.after(() => Promise.all([root, codexHome, admin].map((item) => fs.rm(item, { recursive: true, force: true }))));
  const skillText = (name) => `---\nname: ${name}\ndescription: ${name} workflow.\n---\n\nOutcome, success, evidence, permissions, and stop.\n`;
  await write(path.join(codexHome, "skills", "user-skill", "SKILL.md"), [
    "---",
    "name: user-skill",
    "description: user-skill workflow.",
    "metadata:",
    "  short-description: Valid nested metadata",
    "---",
    "",
    "Outcome, success, evidence, permissions, and stop.",
    "",
  ].join("\n"));
  await write(path.join(admin, "admin-skill", "SKILL.md"), skillText("admin-skill"));
  await write(path.join(system, "system-skill", "SKILL.md"), skillText("system-skill"));
  await write(path.join(codexHome, "skills", "user-skill", "agents", "openai.yaml"), [
    "dependencies:",
    "  tools:",
    "    - type: \"mcp\"",
    "      value: \"officialDocs\"",
    "      url: \"https://token:secret@example.invalid/mcp?key=secret#fragment\"",
    "",
  ].join("\n"));

  // When: user scope is audited with explicit deterministic fixture roots.
  const report = await buildHarnessDoctorReport({
    root, codexHome, scope: "user", codexCommand: "__missing_codex__",
    adminSkillRoots: [admin], systemSkillRoots: [system],
  });

  // Then: sources are labeled without duplicate system discovery and dependencies are recorded as facts.
  assert.equal(report.inventory.skills.find((item) => item.name === "user-skill")?.scope, "user");
  assert.equal(report.inventory.skills.find((item) => item.name === "user-skill")?.status, "valid");
  assert.equal(report.inventory.skills.find((item) => item.name === "admin-skill")?.scope, "admin");
  assert.equal(report.inventory.skills.find((item) => item.name === "system-skill")?.scope, "system");
  assert.equal(report.inventory.skills.filter((item) => item.name === "system-skill").length, 1);
  assert.deepEqual(report.inventory.skills.find((item) => item.name === "user-skill")?.dependencies.tools, [{
    type: "mcp", value: "officialDocs", url: "https://REDACTED:REDACTED@example.invalid/mcp",
  }]);
});
