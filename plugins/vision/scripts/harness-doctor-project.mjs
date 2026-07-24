import fs from "node:fs/promises";
import path from "node:path";
import {
  exists,
  finding,
  isInside,
  portablePath,
  readJson,
  sha256File,
  sortRecords,
  walk,
} from "./harness-doctor-utils.mjs";

async function manifestInventory(root, manifestFile) {
  if (!(await exists(manifestFile))) return { records: [], findings: [], status: "missing" };
  const parsed = await readJson(manifestFile);
  if (!parsed.value || parsed.value.owner !== "vision" || typeof parsed.value.files !== "object") return {
    records: [], status: "unreadable",
    findings: [finding({
      code: "untrusted-install-manifest", category: "harness", recommendation: "manual-review",
      rationale: "The Vision install manifest is malformed or does not assert Vision ownership.",
      evidence: [portablePath(manifestFile)], ownership: "unknown",
    })],
  };
  const records = [];
  const findings = [];
  const resolvedRoot = await fs.realpath(root);
  for (const [relative, record] of Object.entries(parsed.value.files).sort(([left], [right]) => left.localeCompare(right))) {
    const file = path.resolve(root, relative);
    if (!isInside(root, file)) {
      records.push({ path: portablePath(file), relative, status: "unsafe", ownership: "unknown", modified: null });
      findings.push(finding({
        code: "manifest-path-escape", category: "harness", status: "fail", severity: "error",
        recommendation: "manual-review", rationale: "An install-manifest entry resolves outside the audited project.",
        evidence: [portablePath(manifestFile), portablePath(file)], ownership: "unknown",
      }));
      continue;
    }
    if (!record || typeof record !== "object" || !/^[a-f0-9]{64}$/i.test(record.installed_sha256 || "")) {
      records.push({ path: portablePath(file), relative, status: "unsafe", ownership: "unknown", modified: null });
      findings.push(finding({
        code: "invalid-install-manifest-entry", category: "harness", status: "fail", severity: "error",
        recommendation: "manual-review", rationale: "An install-manifest entry lacks a valid installed SHA-256 ownership record.",
        evidence: [portablePath(manifestFile), portablePath(file)], ownership: "unknown",
      }));
      continue;
    }
    if (!(await exists(file))) {
      records.push({ path: portablePath(file), relative, status: "missing", ownership: "framework-owned-missing", modified: null });
      findings.push(finding({
        code: "missing-framework-file", category: "harness", recommendation: "update",
        rationale: "A manifest-owned framework file is missing; preview a Vision update.",
        evidence: [portablePath(manifestFile), portablePath(file)], ownership: "framework-owned-missing",
        preview: "vision update --target <repo>",
      }));
      continue;
    }
    let resolvedFile;
    try {
      resolvedFile = await fs.realpath(file);
    } catch {
      records.push({ path: portablePath(file), relative, status: "unsafe", ownership: "unknown", modified: null });
      findings.push(finding({
        code: "manifest-resolved-path-unreadable", category: "harness", status: "fail", severity: "error",
        recommendation: "manual-review", rationale: "An existing install-manifest path could not be resolved safely.",
        evidence: [portablePath(manifestFile), portablePath(file)], ownership: "unknown",
      }));
      continue;
    }
    if (!isInside(resolvedRoot, resolvedFile)) {
      records.push({ path: portablePath(file), relative, status: "unsafe", ownership: "unowned", modified: null });
      findings.push(finding({
        code: "manifest-resolved-path-escape", category: "harness", status: "fail", severity: "error",
        recommendation: "manual-review", rationale: "An install-manifest entry resolves outside the audited project through a link.",
        evidence: [portablePath(manifestFile), portablePath(file), portablePath(resolvedFile)], ownership: "unowned",
      }));
      continue;
    }
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) {
      records.push({ path: portablePath(file), relative, status: "symlink", ownership: "unowned", modified: null });
      findings.push(finding({
        code: "manifest-owned-symlink", category: "harness", recommendation: "retain",
        rationale: "A manifest path is now a symlink; preserve it until ownership is manually resolved.",
        evidence: [portablePath(manifestFile), portablePath(file)], ownership: "unowned",
      }));
      continue;
    }
    if (!stat.isFile()) {
      records.push({ path: portablePath(file), relative, status: "unsafe", ownership: "unknown", modified: null });
      findings.push(finding({
        code: "manifest-entry-not-file", category: "harness", status: "fail", severity: "error",
        recommendation: "manual-review", rationale: "An install-manifest entry resolves to a non-file and cannot prove file ownership.",
        evidence: [portablePath(manifestFile), portablePath(file)], ownership: "unknown",
      }));
      continue;
    }
    const currentHash = await sha256File(file);
    const current = currentHash === record.installed_sha256;
    records.push({
      path: portablePath(file), relative, status: current ? "current" : "modified",
      ownership: current ? "framework-owned-current" : "framework-owned-modified",
      modified: !current, installed_sha256: record.installed_sha256 || null, current_sha256: currentHash,
    });
    if (!current) findings.push(finding({
      code: "modified-framework-file", category: "harness", recommendation: "retain",
      rationale: "A framework-owned file differs from its installed hash and must be preserved by default.",
      evidence: [portablePath(manifestFile), portablePath(file)], ownership: "framework-owned-modified",
      modified: true, preview: "vision update --target <repo>", confirmationRequired: true,
    }));
  }
  return { records, findings, status: "read" };
}

async function projectSurfaces(root) {
  const surfaces = [];
  for (const [kind, relative] of [
    ["configuration", ".vision/config.json"],
    ["lifecycle", ".vision/bin/agentic-lifecycle.mjs"],
    ["execution-graph", ".vision/bin/execution-graph.mjs"],
    ["project-context", ".vision/project-context.md"],
  ]) {
    const file = path.join(root, relative);
    surfaces.push({ kind, path: portablePath(file), status: await exists(file) ? "present" : "absent", ownership: "unowned", modified: null });
  }
  const contractsRoot = path.join(root, ".vision", "tasks");
  const contracts = await walk(contractsRoot, (file, kind) => kind === "file" && file.endsWith(".json"));
  for (const item of contracts) {
    const parsed = await readJson(item.path);
    surfaces.push({ kind: "task-contract", path: portablePath(item.path), status: parsed.status, ownership: "unowned", modified: null });
  }
  return surfaces;
}

export async function inventoryProject(root) {
  const manifestFile = await exists(path.join(root, ".vision", "install-manifest.json"))
    ? path.join(root, ".vision", "install-manifest.json")
    : path.join(root, ".agentic", "install-manifest.json");
  const manifest = await manifestInventory(root, manifestFile);
  const sourceCheckout = await exists(path.join(root, "plugins", "vision", ".codex-plugin", "plugin.json"));
  return {
    subjectKind: manifest.status === "read" ? "installed-project" : sourceCheckout ? "vision-source-checkout" : "project",
    records: sortRecords([...await projectSurfaces(root), ...manifest.records]),
    findings: sortRecords(manifest.findings),
    source: { kind: "install-manifest", path: portablePath(manifestFile), status: manifest.status },
  };
}
