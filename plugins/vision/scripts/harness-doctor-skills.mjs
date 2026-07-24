import fs from "node:fs/promises";
import path from "node:path";
import {
  contextFor,
  exists,
  finding,
  isInside,
  parseFrontmatter,
  portablePath,
  redactLocator,
  sha256File,
  sortRecords,
  walk,
} from "./harness-doctor-utils.mjs";

function isSkillFile(file) {
  if (path.basename(file).toLowerCase() !== "skill.md") return false;
  const segments = portablePath(file).split("/");
  return segments.some((segment, index) => segment === "skills" && index < segments.length - 1);
}

function promptSignals(body) {
  const lower = body.toLowerCase();
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 20);
  const duplicates = [...new Set(lines.filter((line, index) => lines.indexOf(line) !== index))].sort();
  return {
    outcome: /\b(outcome|goal|result)\b/.test(lower),
    success: /\b(success|acceptance|complete|done)\b/.test(lower),
    evidence: /\b(evidence|verify|validation|test)\b/.test(lower),
    permissions: /\b(permission|approval|mutat|write|read-only|destructive)\b/.test(lower),
    stop: /\b(stop|blocker|until|complete)\b/.test(lower),
    repeated_instructions: duplicates,
  };
}

function pathKey(file) {
  const normalized = portablePath(file);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function configuredSkill(config, file) {
  const expected = pathKey(file);
  return Object.entries(config.skills).find(([candidate]) => pathKey(candidate) === expected)?.[1];
}

async function skillDependencies(skillFile) {
  const file = path.join(path.dirname(skillFile), "agents", "openai.yaml");
  if (!(await exists(file))) return { path: portablePath(file), status: "absent", tools: [] };
  try {
    const content = await fs.readFile(file, "utf8");
    const tools = [];
    let current = null;
    for (const line of content.split(/\r?\n/)) {
      const type = line.match(/^\s*-\s+type:\s*["']?([^"']+?)["']?\s*$/);
      if (type) { current = { type: type[1], value: null, url: null }; tools.push(current); continue; }
      const field = line.match(/^\s+(value|url):\s*["']?([^"']+?)["']?\s*$/);
      if (field && current) current[field[1]] = field[1] === "url" ? redactLocator(field[2]) : field[2];
    }
    return { path: portablePath(file), status: "read", tools };
  } catch { return { path: portablePath(file), status: "unreadable", tools: [] }; }
}

async function skillRecord(input) {
  const normalizedPath = portablePath(input.file);
  const configured = configuredSkill(input.config, normalizedPath);
  const enabled = configured?.enabled ?? (input.source === "plugin" ? input.providerEnabled ?? null : true);
  if (input.kind === "symlink") {
    return {
      path: normalizedPath,
      scope: input.scope,
      source: input.source,
      context: contextFor(input.contextRoot, input.file),
      ownership: "unowned",
      enabled,
      provider: input.source === "plugin" ? input.provider || null : null,
      name: path.basename(input.file),
      description: null,
      status: "symlink",
      prompt_contract: null,
    };
  }
  const content = await fs.readFile(input.file, "utf8");
  const metadata = parseFrontmatter(content);
  const dependencies = await skillDependencies(input.file);
  return {
    path: normalizedPath,
    scope: input.scope,
    source: input.source,
    context: contextFor(input.contextRoot, input.file),
    ownership: input.source === "plugin" ? "plugin-owned" : "unowned",
    enabled,
    provider: input.source === "plugin" ? input.provider || null : null,
    name: metadata.name,
    description: metadata.description,
    status: metadata.errors.length ? "malformed" : "valid",
    metadata_errors: metadata.errors,
    sha256: await sha256File(input.file),
    modified: null,
    dependencies,
    prompt_contract: promptSignals(metadata.body),
  };
}

async function recordsUnder(input) {
  if (!(await exists(input.root))) return [];
  const entries = await walk(input.root, (file, kind) => kind === "symlink"
    || isSkillFile(file)
    || (input.skillRoot && path.basename(file).toLowerCase() === "skill.md"));
  const records = [];
  for (const entry of entries) {
    if (input.source === "user" && portablePath(entry.path).includes("/skills/.system/")) continue;
    if (entry.kind === "symlink") {
      const parent = portablePath(path.dirname(entry.path));
      if (!parent.endsWith("/skills")) continue;
    }
    records.push(await skillRecord({ ...input, file: entry.path, kind: entry.kind }));
  }
  return records;
}

export async function inventorySkills(options) {
  const inputs = [];
  if (options.scope !== "user") inputs.push({ root: options.root, contextRoot: options.root, scope: "project", source: "repository", config: options.config });
  if (options.scope !== "project" && options.codexHome) {
    inputs.push({ root: path.join(options.codexHome, "skills"), contextRoot: options.codexHome, scope: "user", source: "user", config: options.config, skillRoot: true });
    inputs.push({ root: path.join(path.dirname(options.codexHome), ".agents", "skills"), contextRoot: path.dirname(options.codexHome), scope: "user", source: "user", config: options.config, skillRoot: true });
    const adminRoots = options.adminSkillRoots || [process.platform === "win32"
      ? path.join(process.env.ProgramData || "C:\\ProgramData", "Codex", "skills")
      : "/etc/codex/skills"];
    const systemRoots = options.systemSkillRoots || [path.join(options.codexHome, "skills", ".system")];
    for (const root of adminRoots) inputs.push({ root, contextRoot: root, scope: "admin", source: "admin", config: options.config, skillRoot: true });
    for (const root of systemRoots) inputs.push({ root, contextRoot: root, scope: "system", source: "system", config: options.config, skillRoot: true });
  }
  for (const pluginRoot of options.pluginRoots) {
    if (!isInside(pluginRoot.root, pluginRoot.skillsRoot)) continue;
    inputs.push({
      root: pluginRoot.skillsRoot,
      contextRoot: pluginRoot.root,
      scope: pluginRoot.scope,
      source: "plugin",
      config: options.config,
      skillRoot: true,
      providerEnabled: pluginRoot.providerEnabled,
      provider: {
        id: pluginRoot.providerId,
        installation: pluginRoot.providerInstallation,
        version: pluginRoot.providerVersion,
      },
    });
  }
  const records = [];
  for (const input of inputs) records.push(...await recordsUnder(input));
  const unique = [...new Map(records.map((record) => [pathKey(record.path), record])).values()];
  const findings = [];
  for (const record of unique) {
    if (record.status === "malformed") findings.push(finding({
      code: "malformed-skill-metadata",
      category: "skill",
      recommendation: "update",
      rationale: `Skill metadata is invalid: ${record.metadata_errors.join(", ")}.`,
      evidence: [record.path],
      ownership: record.ownership,
      confirmationRequired: record.ownership !== "plugin-owned",
    }));
    if (record.status === "symlink") findings.push(finding({
      code: "external-skill-symlink",
      category: "skill",
      recommendation: "manual-review",
      rationale: "A skill entry is a symlink and was not followed or treated as owned.",
      evidence: [record.path],
      ownership: "unowned",
    }));
  }
  const operational = unique.filter((record) => record.context === "operational" && record.status === "valid");
  for (const name of [...new Set(operational.map((record) => record.name).filter(Boolean))].sort()) {
    const matches = operational.filter((record) => record.name === name);
    const hashes = new Set(matches.map((record) => record.sha256).filter(Boolean));
    if (matches.length > 1 && hashes.size > 1) findings.push(finding({
      code: "duplicate-skill-candidate",
      category: "skill",
      recommendation: "manual-review",
      rationale: `Skill name ${name} has divergent content across multiple non-historical inventory locations; confirm runtime precedence before consolidation.`,
      evidence: matches.map((record) => record.path),
      ownership: "mixed", confidence: "medium",
    }));
  }
  return { records: sortRecords(unique), findings: sortRecords(findings) };
}
