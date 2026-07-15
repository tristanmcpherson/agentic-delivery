#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MANIFEST_RELATIVE = ".agentic/install-manifest.json";
const MANIFEST_SCHEMA_VERSION = 1;

function parse(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return args;
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function listFiles(root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else files.push(full);
  }
  return files;
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function relativeUnix(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function destinationFor(target, relative) {
  const destination = path.resolve(target, relative);
  const prefix = `${path.resolve(target)}${path.sep}`;
  const comparable = process.platform === "win32" ? destination.toLowerCase() : destination;
  const comparablePrefix = process.platform === "win32" ? prefix.toLowerCase() : prefix;
  if (!comparable.startsWith(comparablePrefix)) throw new Error(`Refusing path outside target: ${relative}`);
  return destination;
}

async function loadManifest(file, force) {
  if (!(await exists(file))) return null;
  try {
    const manifest = await readJson(file);
    if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION || manifest.owner !== "vision" || !manifest.files || typeof manifest.files !== "object") throw new Error("unsupported manifest shape");
    return manifest;
  } catch (error) {
    if (force) return null;
    throw new Error(`Cannot trust existing ${file}: ${error.message}. Repair it or pass --force after reviewing the target.`);
  }
}

async function mappingsFor(pluginRoot, target) {
  const templateRoot = path.join(pluginRoot, "assets", "project-template");
  const mappings = [];
  for (const source of await listFiles(templateRoot)) {
    const relative = relativeUnix(templateRoot, source);
    mappings.push({ source, relative, destination: destinationFor(target, relative) });
  }
  for (const [sourceRelative, destinationRelative] of [
    ["scripts/agentic.mjs", ".agentic/bin/agentic.mjs"],
    ["scripts/agentic-harness.mjs", ".agentic/bin/agentic-harness.mjs"],
    ["scripts/agentic-lifecycle.mjs", ".agentic/bin/agentic-lifecycle.mjs"],
    ["scripts/sign-verifier-grant.mjs", ".agentic/bin/sign-verifier-grant.mjs"],
    ["scripts/sign-delivery-attestation.mjs", ".agentic/bin/sign-delivery-attestation.mjs"],
    ["assets/playwright/agentic-evidence.mjs", "tests/e2e/support/agentic-evidence.mjs"],
    ["assets/playwright/agentic-reporter.mjs", "tests/e2e/support/agentic-reporter.mjs"],
  ]) mappings.push({ source: path.join(pluginRoot, sourceRelative), relative: destinationRelative, destination: destinationFor(target, destinationRelative) });
  return mappings.sort((left, right) => left.relative.localeCompare(right.relative));
}

async function planInstall(mappings, manifest, force) {
  const actions = [];
  for (const mapping of mappings) {
    const sourceSha256 = await sha256(mapping.source);
    const present = await exists(mapping.destination);
    const previous = manifest?.files?.[mapping.relative] || null;
    let currentSha256 = present ? await sha256(mapping.destination) : null;
    let action;
    let reason;
    if (!present) {
      action = "create";
      reason = previous ? "managed file is missing" : "file is absent";
    } else if (force) {
      action = currentSha256 === sourceSha256 ? "keep" : "overwrite";
      reason = "explicit --force";
    } else if (!previous) {
      action = "preserve";
      reason = "existing file is not owned by the Vision manifest";
    } else if (currentSha256 !== previous.installed_sha256) {
      action = "preserve";
      reason = "managed file was modified after installation";
    } else if (currentSha256 === sourceSha256) {
      action = "keep";
      reason = "managed file is current";
    } else {
      action = "update";
      reason = "managed file is unmodified and a new source version exists";
    }
    actions.push({ ...mapping, action, reason, source_sha256: sourceSha256, current_sha256: currentSha256, previous });
  }
  return actions;
}

async function applyInstall(actions, target, pluginVersion, manifestFile) {
  const files = {};
  for (const item of actions) {
    const managed = ["create", "update", "overwrite", "keep"].includes(item.action) || Boolean(item.previous);
    if (["create", "update", "overwrite"].includes(item.action)) {
      await fs.mkdir(path.dirname(item.destination), { recursive: true });
      await fs.copyFile(item.source, item.destination);
      item.current_sha256 = item.source_sha256;
    }
    if (managed && item.action !== "preserve" || item.previous) {
      files[item.relative] = {
        source_sha256: item.source_sha256,
        installed_sha256: ["create", "update", "overwrite", "keep"].includes(item.action) ? item.source_sha256 : item.previous.installed_sha256,
      };
    }
  }
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    owner: "vision",
    plugin_version: pluginVersion,
    target: ".",
    files,
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const existing = (await exists(manifestFile)) ? await fs.readFile(manifestFile, "utf8") : null;
  if (existing !== serialized) {
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    const temporary = `${manifestFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, serialized, "utf8");
    await fs.rename(temporary, manifestFile);
  }
  return manifest;
}

async function planUninstall(target, manifest) {
  if (!manifest) throw new Error("No Vision install manifest exists; refusing to infer file ownership.");
  const actions = [];
  for (const [relative, record] of Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right))) {
    const destination = destinationFor(target, relative);
    if (!(await exists(destination))) actions.push({ relative, destination, action: "missing", reason: "managed file is already absent", record });
    else {
      const current = await sha256(destination);
      actions.push({ relative, destination, action: current === record.installed_sha256 ? "remove" : "preserve", reason: current === record.installed_sha256 ? "file still matches the installed hash" : "file was modified after installation", record });
    }
  }
  return actions;
}

async function applyUninstall(actions, manifest, manifestFile) {
  const remaining = {};
  for (const item of actions) {
    if (item.action === "remove") await fs.rm(item.destination, { force: true });
    else if (item.action === "preserve") remaining[item.relative] = item.record;
  }
  if (Object.keys(remaining).length === 0) await fs.rm(manifestFile, { force: true });
  else {
    const updated = { ...manifest, files: remaining };
    await fs.writeFile(manifestFile, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  }
}

function printPlan(actions, apply, uninstall) {
  for (const item of actions) console.log(`${apply ? item.action.toUpperCase() : `WOULD ${item.action.toUpperCase()}`} ${item.relative} - ${item.reason}`);
  if (!apply) console.log(`Dry run only. Re-run with ${uninstall ? "--uninstall " : ""}--apply after reviewing the plan.`);
  const preserved = actions.filter((item) => item.action === "preserve").length;
  if (preserved) console.log(`${preserved} existing or modified file(s) were preserved.`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parse(argv);
  const target = path.resolve(String(args.target || process.cwd()));
  const apply = args.apply === true;
  const force = args.force === true;
  const uninstall = args.uninstall === true;
  if (uninstall && force) throw new Error("--force is not used for uninstall; modified files are always preserved.");
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const plugin = await readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const manifestFile = destinationFor(target, MANIFEST_RELATIVE);
  const manifest = await loadManifest(manifestFile, force);
  const actions = uninstall ? await planUninstall(target, manifest) : await planInstall(await mappingsFor(pluginRoot, target), manifest, force);
  if (apply) {
    if (uninstall) await applyUninstall(actions, manifest, manifestFile);
    else await applyInstall(actions, target, plugin.version, manifestFile);
  }
  const summary = {
    schema_version: 1,
    operation: uninstall ? "uninstall" : "install",
    mode: apply ? "apply" : "preview",
    target,
    plugin_version: plugin.version,
    manifest: MANIFEST_RELATIVE,
    counts: Object.fromEntries([...new Set(actions.map((item) => item.action))].sort().map((action) => [action, actions.filter((item) => item.action === action).length])),
    actions: actions.map(({ relative, action, reason, source_sha256, current_sha256 }) => ({ path: relative, action, reason, source_sha256: source_sha256 || null, current_sha256: current_sha256 || null })),
  };
  if (args.json === true) console.log(JSON.stringify(summary, null, 2));
  else printPlan(actions, apply, uninstall);
  return summary;
}

async function sameFile(left, right) {
  try {
    const [realLeft, realRight] = await Promise.all([fs.realpath(left), fs.realpath(right)]);
    return realLeft === realRight;
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

const isEntrypoint = process.argv[1] && await sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
