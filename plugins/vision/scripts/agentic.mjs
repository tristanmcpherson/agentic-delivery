#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main as harnessMain } from "./agentic-harness.mjs";
import { main as harnessDoctorMain } from "./harness-doctor.mjs";
import { main as lifecycleMain } from "./agentic-lifecycle.mjs";
import { main as campaignMain } from "./vision-campaign.mjs";
import { main as managerMain } from "./vision-manager.mjs";

const HARNESS_COMMANDS = new Set(["doctor", "validate-task", "goal-spec", "graph-plan", "grant-request", "delivery-request", "delivery-record", "run", "status", "visual-review", "advisory-review"]);
const LIFECYCLE_COMMANDS = new Set(["worktree-create", "activate", "resume", "checkpoint", "context", "deactivate"]);

function printHelp() {
  console.log(`Vision

Repository setup:
  install [--target path] [--apply] [--force] [--json]
  update [--target path] [--apply] [--force] [--json]
  uninstall [--target path] [--apply] [--json]
  harness-doctor [--root path] [--codex-home path] [--scope project|user|all] [--json]

Lifecycle:
  worktree-create | activate | resume | checkpoint | context | deactivate

Campaign:
  campaign init | preflight | run | resume | status | verify | cancel

Manager:
  manager status | inspect | plan [--root path] [--worker-state file] [--approval file] [--automation-ownership file] [--project-target file] [--json]

Assurance and orchestration:
  doctor | validate-task | goal-spec | graph-plan | grant-request | delivery-request | delivery-record | run | status | visual-review | advisory-review

Install, update, and uninstall preview by default. State-changing setup requires --apply; approval-bearing delivery still requires the harness's signed protected-controller evidence.
`);
}

async function installerMain(command, args) {
  const installer = path.join(path.dirname(fileURLToPath(import.meta.url)), "install-project.mjs");
  try {
    await fs.access(installer);
  } catch {
    throw new Error("Repository installation is available from the plugin source checkout, not the installed project-local CLI copy.");
  }
  const module = await import(pathToFileURL(installer));
  return module.main([...(command === "uninstall" ? ["--uninstall"] : []), ...args]);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") return printHelp();
  if (["install", "update", "uninstall"].includes(command)) return installerMain(command, args);
  if (command === "harness-doctor") return harnessDoctorMain(args);
  if (command === "campaign") return campaignMain(args);
  if (command === "manager") return managerMain(args);
  if (LIFECYCLE_COMMANDS.has(command)) return lifecycleMain([command, ...args]);
  if (HARNESS_COMMANDS.has(command)) return harnessMain([command, ...args]);
  throw new Error(`Unknown command: ${command}`);
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
    process.exitCode = error.exitCode || 1;
  });
}
