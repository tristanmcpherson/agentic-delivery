import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".omo"]);
const HISTORICAL_SEGMENTS = new Set(["archive", "archives", "baseline", "baselines", "evaluation", "fixture", "fixtures", "proof", "snapshots", "test", "tests"]);

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function portablePath(file) {
  return path.resolve(file).replaceAll("\\", "/");
}

export function redactLocator(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "REDACTED";
    if (parsed.password) parsed.password = "REDACTED";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch { return "REDACTED-INVALID-LOCATOR"; }
}

export function contextFor(root, file) {
  const segments = path.relative(root, file).split(path.sep).map((segment) => segment.toLowerCase());
  return segments.some((segment) => HISTORICAL_SEGMENTS.has(segment)) ? "historical" : "operational";
}

export async function sha256File(file) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

export function sha256Value(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export async function readJson(file) {
  try {
    return { status: "read", value: JSON.parse(await fs.readFile(file, "utf8")), error: null };
  } catch (error) {
    return { status: "unreadable", value: null, error: error.message };
  }
}

export async function walk(root, predicate = () => true) {
  if (!(await exists(root))) return [];
  const results = [];
  const visit = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (predicate(full, "symlink")) results.push({ path: full, kind: "symlink" });
      } else if (entry.isDirectory()) {
        const generatedAgentic = full.includes(`${path.sep}.agentic${path.sep}evidence${path.sep}`)
          || full.includes(`${path.sep}.agentic${path.sep}campaigns${path.sep}`);
        if (!IGNORED_DIRECTORIES.has(entry.name) && !generatedAgentic) await visit(full);
      } else if (predicate(full, "file")) results.push({ path: full, kind: "file" });
    }
  };
  await visit(root);
  return results;
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { name: null, description: null, body: content, errors: ["missing YAML frontmatter"] };
  const values = {};
  const errors = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s/.test(line)) continue;
    const field = line.match(/^([a-zA-Z0-9_-]+):\s*(.*?)\s*$/);
    if (!field) { errors.push(`unsupported frontmatter line: ${line}`); continue; }
    values[field[1]] = field[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!values.name) errors.push("missing name");
  if (!values.description) errors.push("missing description");
  return { name: values.name || null, description: values.description || null, body: content.slice(match[0].length), errors };
}

export function finding(input) {
  const evidence = [...new Set(input.evidence || [])].sort();
  const identity = `${input.code}\0${evidence.join("\0")}\0${input.rationale}`;
  return {
    id: `${input.code}-${sha256Value(identity).slice(0, 12)}`,
    code: input.code,
    category: input.category,
    status: input.status || "attention",
    severity: input.severity || "warning",
    confidence: input.confidence || "high",
    ownership: input.ownership || "unknown",
    modified: input.modified ?? null,
    recommendation: input.recommendation,
    rationale: input.rationale,
    evidence,
    preview: input.preview || null,
    confirmation_required: input.confirmationRequired ?? true,
  };
}

export function runTool(command, args) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(command, args, { windowsHide: true, shell: false }); }
    catch (error) { resolve({ status: "unknown", detail: error.message }); return; }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ status: "unknown", detail: error.message }));
    child.on("close", (code) => resolve(code === 0
      ? { status: "available", detail: stdout.trim() }
      : { status: "unknown", detail: stderr.trim() || `exit ${code}` }));
  });
}

export function sortRecords(records) {
  return records.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
