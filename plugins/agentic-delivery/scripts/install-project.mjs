#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

async function listFiles(root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else files.push(full);
  }
  return files;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const target = path.resolve(String(args.target || process.cwd()));
  const apply = args.apply === true;
  const force = args.force === true;
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const templateRoot = path.join(pluginRoot, "assets", "project-template");
  const mappings = [];
  for (const source of await listFiles(templateRoot)) {
    mappings.push({ source, destination: path.join(target, path.relative(templateRoot, source)) });
  }
  mappings.push({ source: path.join(pluginRoot, "scripts", "agentic-harness.mjs"), destination: path.join(target, ".agentic", "bin", "agentic-harness.mjs") });
  mappings.push({ source: path.join(pluginRoot, "scripts", "sign-verifier-grant.mjs"), destination: path.join(target, ".agentic", "bin", "sign-verifier-grant.mjs") });
  mappings.push({ source: path.join(pluginRoot, "assets", "playwright", "agentic-evidence.mjs"), destination: path.join(target, "tests", "e2e", "support", "agentic-evidence.mjs") });
  mappings.push({ source: path.join(pluginRoot, "assets", "playwright", "agentic-reporter.mjs"), destination: path.join(target, "tests", "e2e", "support", "agentic-reporter.mjs") });

  let conflicts = 0;
  for (const mapping of mappings) {
    const present = await exists(mapping.destination);
    const action = present && !force ? "SKIP" : apply ? (present ? "OVERWRITE" : "CREATE") : (present ? "WOULD OVERWRITE" : "WOULD CREATE");
    if (present && !force) conflicts += 1;
    console.log(`${action} ${path.relative(target, mapping.destination)}`);
    if (apply && (!present || force)) {
      await fs.mkdir(path.dirname(mapping.destination), { recursive: true });
      await fs.copyFile(mapping.source, mapping.destination);
    }
  }
  if (!apply) console.log("Dry run only. Re-run with --apply after reviewing the plan.");
  if (conflicts) console.log(`${conflicts} existing file(s) were preserved. Tailor or merge them deliberately.`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
