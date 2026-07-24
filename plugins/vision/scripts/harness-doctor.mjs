#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readCodexConfig } from "./harness-doctor-config.mjs";
import { inventoryModels } from "./harness-doctor-models.mjs";
import { inventoryPlugins } from "./harness-doctor-plugins.mjs";
import { inventoryProject } from "./harness-doctor-project.mjs";
import { inventorySkills } from "./harness-doctor-skills.mjs";
import { exists, finding, portablePath, runTool, sortRecords } from "./harness-doctor-utils.mjs";

const VALID_SCOPES = new Set(["project", "user", "all"]);

class UsageError extends Error {
  constructor(message) { super(message); this.exitCode = 2; }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new UsageError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return args;
}

function counts(records) {
  const result = {};
  for (const record of records) result[record.category] = (result[record.category] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function overallFor(findings) {
  if (findings.some((item) => item.status === "fail")) return "fail";
  if (findings.some((item) => item.status === "attention")) return "attention";
  return "pass";
}

async function toolInventory(command) {
  let result;
  if (process.platform === "win32" && !path.isAbsolute(command) && !command.includes("/") && !command.includes("\\")) {
    result = await runTool("where.exe", [command]);
  } else if (path.isAbsolute(command) && await exists(command)) {
    result = { status: "available", detail: portablePath(command) };
  } else {
    result = await runTool(command, ["--version"]);
  }
  const record = { kind: "codex-cli", command, status: result.status, detail: result.detail };
  if (result.status === "available") return { records: [record], findings: [] };
  return {
    records: [record],
    findings: [finding({
      code: "codex-tool-unavailable", category: "tool", status: "unknown", severity: "info",
      recommendation: "manual-review",
      rationale: "The Codex CLI could not be queried, so live tool capability remains unknown; offline inventory is still valid.",
      evidence: [command], ownership: "external", confirmationRequired: false,
    })],
  };
}

export async function buildHarnessDoctorReport(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const scope = options.scope || "project";
  if (!VALID_SCOPES.has(scope)) throw new UsageError(`Invalid scope ${scope}; expected project, user, or all.`);
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || root, ".codex"));
  const config = scope === "project"
    ? { file: portablePath(path.join(codexHome, "config.toml")), status: "not-requested", model: null, reasoningEffort: null, plugins: {}, skills: {}, marketplaces: {} }
    : await readCodexConfig(codexHome);
  const configErrors = config.status === "unreadable"
    ? [{ code: "unreadable-codex-config", source: config.file, detail: "Codex configuration could not be read or parsed by the known-field reader." }]
    : [];
  const configFindings = configErrors.map((error) => finding({
    code: error.code, category: "configuration", status: "unknown", severity: "info",
    recommendation: "manual-review", rationale: error.detail,
    evidence: [error.source], ownership: "unowned", confirmationRequired: false,
  }));
  const plugins = await inventoryPlugins({ root, codexHome, scope, config });
  const skills = await inventorySkills({
    root, codexHome, scope, config, pluginRoots: plugins.pluginRoots,
    adminSkillRoots: options.adminSkillRoots,
    systemSkillRoots: options.systemSkillRoots,
  });
  const project = scope === "user" ? null : await inventoryProject(root);
  const models = await inventoryModels({ root, codexHome, scope, config });
  const tools = await toolInventory(options.codexCommand || "codex");
  const findings = sortRecords([
    ...plugins.findings,
    ...skills.findings,
    ...(project?.findings || []),
    ...models.findings,
    ...tools.findings,
    ...configFindings,
  ]);
  const sources = [
    ...(scope === "user" ? [] : [{ kind: "repository", path: portablePath(root), status: "read" }]),
    ...(scope === "project" ? [] : [{ kind: "codex-config", path: config.file, status: config.status }]),
    ...(project ? [project.source] : []),
  ];
  const inventory = {
    skills: skills.records,
    plugins: plugins.plugins,
    marketplaces: plugins.marketplaces,
    harness: project?.records || [],
    model_references: models.records,
    tools: tools.records,
  };
  return {
    schema_version: 1,
    mode: "diagnostic-read-only",
    scope,
    subject: { root, codex_home: scope === "project" ? null : codexHome, kind: project?.subjectKind || "user-environment" },
    sources: sortRecords(sources),
    inventory,
    findings,
    semantic_review: {
      requires_model_judgment: true,
      policy: "Interpret prompt quality, overlap, and GPT-5.6 role fit from the recorded evidence; never convert ambiguity into deletion authority.",
      queue: findings.filter((item) => item.recommendation === "manual-review").map((item) => item.id),
    },
    summary: {
      overall: overallFor(findings),
      inventory: Object.fromEntries(Object.entries(inventory).map(([key, value]) => [key, value.length])),
      findings: counts(findings),
    },
    errors: configErrors,
  };
}

export function renderHarnessDoctor(report) {
  const lines = [
    `${report.summary.overall.toUpperCase()} harness-doctor (${report.scope}, read-only)`,
    `Skills ${report.inventory.skills.length} | Plugins ${report.inventory.plugins.length} | Harness ${report.inventory.harness.length} | Findings ${report.findings.length}`,
  ];
  for (const item of report.findings) lines.push(`- [${item.status}] ${item.code}: ${item.rationale}`);
  if (report.semantic_review.queue.length) lines.push(`Semantic review required for ${report.semantic_review.queue.length} finding(s); no changes were made.`);
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help === true) {
    console.log("Usage: agentic.mjs harness-doctor [--root path] [--codex-home path] [--scope project|user|all] [--codex-command path] [--json]");
    return null;
  }
  const report = await buildHarnessDoctorReport({
    root: args.root,
    codexHome: args["codex-home"],
    scope: args.scope,
    codexCommand: args["codex-command"],
  });
  console.log(args.json === true ? JSON.stringify(report, null, 2) : renderHarnessDoctor(report));
  if (report.summary.overall === "fail") process.exitCode = 1;
  return report;
}

async function sameFile(left, right) {
  try { return await import("node:fs/promises").then(async ({ realpath }) => await realpath(left) === await realpath(right)); }
  catch { return path.resolve(left) === path.resolve(right); }
}

const isEntrypoint = process.argv[1] && await sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isEntrypoint) main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = error.exitCode || 1; });
