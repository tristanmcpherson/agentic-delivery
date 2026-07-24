import fs from "node:fs/promises";
import path from "node:path";
import { contextFor, finding, portablePath, sortRecords, walk } from "./harness-doctor-utils.mjs";

const TEXT_EXTENSIONS = new Set([".json", ".md", ".toml", ".yaml", ".yml"]);
const MODEL_PATTERN = /\bgpt-5(?:\.\d+)?(?:-[a-z0-9.-]+)?\b/gi;

function roleFor(file, configuredFile) {
  if (portablePath(file) === portablePath(configuredFile)) return "configured-default";
  if (portablePath(file).includes("/.codex/agents/")) return "agent-role";
  return "reference";
}

async function referencesUnder(root, contextRoot, configuredFile) {
  let files = [];
  try {
    const stat = await fs.stat(root);
    files = stat.isFile()
      ? [{ path: root, kind: "file" }]
      : await walk(root, (file, kind) => kind === "file" && TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()));
  } catch { return []; }
  const records = [];
  for (const item of files) {
    const stat = await fs.stat(item.path);
    if (stat.size > 1_000_000) continue;
    const content = await fs.readFile(item.path, "utf8");
    const models = [...new Set(content.match(MODEL_PATTERN) || [])].sort();
    const efforts = [...content.matchAll(/(?:model_reasoning_effort|reasoning_effort|"effort")\s*[=:]\s*["'](none|low|medium|high|xhigh|max|ultra)["']/gi)].map((match) => match[1].toLowerCase());
    for (const model of models) records.push({
      path: portablePath(item.path), context: contextFor(contextRoot, item.path),
      model: model.toLowerCase(), role: roleFor(item.path, configuredFile),
      reasoning_efforts: [...new Set(efforts)].sort(),
    });
    if (!models.length && efforts.length) records.push({
      path: portablePath(item.path), context: contextFor(contextRoot, item.path),
      model: null, role: roleFor(item.path, configuredFile), reasoning_efforts: [...new Set(efforts)].sort(),
    });
  }
  return records;
}

export async function inventoryModels(options) {
  const records = [];
  if (options.scope !== "user") records.push(...await referencesUnder(options.root, options.root, options.config.file));
  if (options.scope !== "project" && options.config.status === "read") {
    if (options.config.model || options.config.reasoningEffort) records.push({
      path: options.config.file,
      context: "operational",
      model: typeof options.config.model === "string" ? options.config.model.toLowerCase() : null,
      role: "configured-default",
      reasoning_efforts: typeof options.config.reasoningEffort === "string" ? [options.config.reasoningEffort.toLowerCase()] : [],
    });
    records.push(...await referencesUnder(path.join(path.dirname(options.config.file), "agents"), path.dirname(options.config.file), options.config.file));
  }
  const unique = [...new Map(records.map((record) => [`${record.path}\0${record.model}\0${record.reasoning_efforts.join(",")}`, record])).values()];
  const findings = [];
  for (const record of unique.filter((item) => item.context === "operational")) {
    if (record.role === "agent-role" && record.model) findings.push(finding({
      code: "role-model-pin", category: "model", recommendation: "manual-review",
      rationale: "A portable agent role pins a model; preserve only when representative evaluation proves the role-specific choice.",
      evidence: [record.path], ownership: "unowned",
    }));
    if (record.role !== "reference" && record.reasoning_efforts.includes("max")) findings.push(finding({
      code: "max-reasoning-effort", category: "model", recommendation: "manual-review",
      rationale: "Max reasoning is configured; retain only for hard quality-first work with measured gain over xhigh or lower.",
      evidence: [record.path], ownership: "unowned",
    }));
    if (record.model?.startsWith("gpt-5") && !record.model.startsWith("gpt-5.6") && record.role !== "reference") findings.push(finding({
      code: "gpt56-update-candidate", category: "model", recommendation: "manual-review",
      rationale: "An operational model setting predates GPT-5.6; map by workload role rather than rewriting globally.",
      evidence: [record.path], ownership: "unowned",
    }));
  }
  return { records: sortRecords(unique), findings: sortRecords(findings) };
}
