#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildGoalSpec, validateConfig, validateTask } from "./agentic-harness.mjs";
import {
  acquireLifecycleLease,
  completionReached,
  deriveMaterialProgressFingerprint,
  evaluateContinuation,
  hashCanonical,
  selectLifecycleAction,
  terminalForBeadStatus,
  transitionLifecycle,
} from "./lifecycle-model.mjs";
import { withLifecycleStateLock } from "./lifecycle-state-store.mjs";

const STATE_SCHEMA_VERSION = 2;
const MAX_HOOK_INPUT_BYTES = 1024 * 1024;
const MAX_CONTEXT_BYTES = 12 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SECRET_LINE_PATTERN = /(api[_-]?key|authorization|bearer|client[_-]?secret|cookie|credential|password|private[_-]?key|refresh[_-]?token|session[_-]?token|access[_-]?token)/i;
const VISION_EXPLICIT_PATTERN = /(?:\$vision(?::vision)?\b|\bvision:vision\b|\b(?:invoke|use)\s+(?:the\s+)?vision(?:\s+skill)?\b)/i;
const VISION_OPTOUT_PATTERN = /(?:\b(?:do not|don't|without)\s+(?:use|using)\s+vision\b|\bno\s+vision\b)/i;
const OTHER_SKILL_PATTERN = /\$[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?\b/i;
const OUTCOME_VERB_PATTERN = /\b(?:add|build|change|complete|continue|convert|create|deploy|finish|fix|implement|integrate|make|migrate|optimize|port|refactor|remove|rename|repair|replace|set\s*up|ship|update|upgrade|wire)\b/i;
const PHASE_LIMIT_PATTERN = /(?:^\s*(?:please\s+)?(?:only\s+|just\s+)?(?:analy[sz]e|audit|compare|diagnose|explain|inspect|investigate|plan|report|research|review|show|summarize|tell|what|why|how)\b|\b(?:only|just)\s+(?:analy[sz]e|audit|compare|diagnose|explain|inspect|investigate|plan|report|research|review|summarize)\b|\b(?:do not|don't)\s+(?:edit|implement|modify|run|write)\b)/i;
const PHASE_TO_OUTCOME_PATTERN = /\b(?:and|then)\s+(?:then\s+)?(?:add|build|change|complete|continue|convert|create|deploy|finish|fix|implement|integrate|make|migrate|optimize|port|refactor|remove|rename|repair|replace|set\s*up|ship|update|upgrade|wire)\b/i;
const DEFAULT_POLICY = Object.freeze({
  max_scouts: 3,
  max_parallel_nodes: 3,
  max_review_retries: 2,
  max_no_progress_resumes: 2,
  max_authorization_failures: 3,
  max_context_percent: 80,
  allow_recursive_subagents: false,
  telemetry: false,
  auto_update: false,
  auto_merge: false,
});

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return parsed;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export const hashValue = hashCanonical;
export { evaluateContinuation };

export function classifyVisionOffer(value) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) return { offer: false, reason: "empty" };
  if (VISION_OPTOUT_PATTERN.test(prompt)) return { offer: false, reason: "vision-opt-out" };
  if (VISION_EXPLICIT_PATTERN.test(prompt)) return { offer: false, reason: "vision-explicit" };
  if (OTHER_SKILL_PATTERN.test(prompt)) return { offer: false, reason: "other-skill-explicit" };
  if (PHASE_LIMIT_PATTERN.test(prompt) && !PHASE_TO_OUTCOME_PATTERN.test(prompt)) return { offer: false, reason: "phase-limited" };
  if (!OUTCOME_VERB_PATTERN.test(prompt)) return { offer: false, reason: "not-an-engineering-outcome" };
  return { offer: true, reason: "engineering-outcome" };
}

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON ${filePath}: ${error.message}`);
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function statePath(root) {
  const home = existsSync(path.join(root, ".vision")) ? ".vision" : ".agentic";
  return path.join(root, home, "state", "active-task.json");
}

async function resolveTaskPath(root, taskArg) {
  if (!taskArg) throw new Error("Pass --task <task-id-or-json-path>.");
  const direct = path.resolve(root, String(taskArg));
  if (await exists(direct)) return direct;
  const named = path.join(root, ".vision", "tasks", String(taskArg).endsWith(".json") ? String(taskArg) : `${taskArg}.json`);
  if (await exists(named)) return named;
  const legacy = path.join(root, ".agentic", "tasks", String(taskArg).endsWith(".json") ? String(taskArg) : `${taskArg}.json`);
  if (await exists(legacy)) return legacy;
  throw new Error(`Task contract not found: ${taskArg}`);
}

async function loadTaskContext(root, taskArg) {
  const preferredConfigPath = path.join(root, ".vision", "config.json");
  const configPath = await exists(preferredConfigPath) ? preferredConfigPath : path.join(root, ".agentic", "config.json");
  if (!(await exists(configPath))) throw new Error(`Configuration not found: ${configPath}`);
  const config = await readJson(configPath);
  validateConfig(config);
  const taskPath = await resolveTaskPath(root, taskArg);
  const task = await readJson(taskPath);
  const errors = validateTask(task, config);
  if (errors.length) throw new Error(`Invalid task contract:\n- ${errors.join("\n- ")}`);
  if (task.schema_version !== 3) throw new Error("Lifecycle activation requires a schema-v3 research and goal contract.");
  const goal = buildGoalSpec(task);
  return { root, configPath, config, taskPath, task, goal, contractHash: hashValue(task) };
}

function policyFor(config) {
  return { ...DEFAULT_POLICY, ...(config.orchestration || {}) };
}

export function validateOrchestrationPolicy(policy) {
  const errors = [];
  for (const [field, minimum, maximum] of [
    ["max_scouts", 1, 3],
    ["max_parallel_nodes", 1, 3],
    ["max_review_retries", 0, 3],
    ["max_no_progress_resumes", 1, 5],
    ["max_authorization_failures", 1, 5],
    ["max_context_percent", 50, 95],
  ]) {
    if (!Number.isInteger(policy[field]) || policy[field] < minimum || policy[field] > maximum) errors.push(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  if (policy.allow_recursive_subagents !== false) errors.push("allow_recursive_subagents must remain false");
  for (const field of ["telemetry", "auto_update", "auto_merge"]) if (policy[field] !== false) errors.push(`${field} must remain false`);
  return errors;
}

function capture(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, windowsHide: true, shell: options.shell === true });
    } catch (error) {
      resolve({ exitCode: -1, stdout: "", stderr: error.message });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ exitCode: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
  });
}

function lifecycleIgnoredPaths(context) {
  const home = existsSync(path.join(context.root, ".vision")) ? ".vision" : ".agentic";
  const ignored = [`${home}/state/**`];
  const evidenceRoot = path.resolve(context.root, context.config.evidence_root || `${home}/evidence`);
  const relative = path.relative(context.root, evidenceRoot).replaceAll("\\", "/");
  if (relative && relative !== "." && !relative.startsWith("../") && relative !== "..") ignored.push(`${relative.replace(/\/+$/g, "")}/**`);
  return ignored;
}

async function gitBinding(root, ignoredPaths = [".vision/state/**"]) {
  const top = await capture("git", ["rev-parse", "--show-toplevel"], { cwd: root });
  if (top.exitCode !== 0) return { available: false, root: null, branch: null, candidate_id: null, detail: top.stderr.trim() || "not a Git worktree" };
  const gitRoot = path.resolve(top.stdout.trim());
  const pathspec = ["--", ".", ...ignoredPaths.map((item) => `:(exclude)${item}`)];
  const [branch, candidate, status, diff] = await Promise.all([
    capture("git", ["branch", "--show-current"], { cwd: root }),
    capture("git", ["rev-parse", "HEAD"], { cwd: root }),
    capture("git", ["status", "--porcelain=v1", "--untracked-files=all", ...pathspec], { cwd: root }),
    capture("git", ["diff", "--binary", "--no-ext-diff", "HEAD", ...pathspec], { cwd: root }),
  ]);
  const candidateId = candidate.exitCode === 0 ? candidate.stdout.trim() : null;
  const statusText = status.exitCode === 0 ? status.stdout : "";
  return {
    available: true,
    root: gitRoot,
    branch: branch.exitCode === 0 ? branch.stdout.trim() || null : null,
    candidate_id: candidateId,
    dirty: status.exitCode === 0 ? Boolean(statusText) : null,
    workspace_candidate_sha256: hashValue({
      candidate_id: candidateId,
      status: statusText,
      diff: diff.exitCode === 0 ? diff.stdout : null,
    }),
    detail: null,
  };
}

async function beadBinding(root, beadId) {
  if (!beadId) return { available: false, id: null, status: "not-configured", detail: "No Bead ID was supplied." };
  if (!/^[a-zA-Z0-9._:-]+$/.test(beadId)) return { available: false, id: beadId, status: "invalid-id", detail: "Bead ID contains unsupported characters." };
  const result = process.platform === "win32"
    ? await capture(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `bd show ${beadId} --json`], { cwd: root })
    : await capture("bd", ["show", beadId, "--json"], { cwd: root });
  if (result.exitCode !== 0) return { available: false, id: beadId, status: "unavailable", detail: result.stderr.trim() || "bd is not available" };
  try {
    const parsed = JSON.parse(result.stdout);
    const bead = Array.isArray(parsed) ? parsed[0] : parsed;
    return { available: true, id: beadId, status: bead?.status || "unknown", title: bead?.title || null, detail: null };
  } catch (error) {
    return { available: false, id: beadId, status: "invalid-output", detail: error.message };
  }
}

async function loadEvidence(context) {
  const file = path.resolve(context.root, context.config.evidence_root || ".vision/evidence", slug(context.task.task_id), "latest.json");
  if (!(await exists(file))) return { file, data: null, content_sha256: null, modified_at: null };
  try {
    const [content, metadata] = await Promise.all([fs.readFile(file), fs.stat(file)]);
    return {
      file,
      data: JSON.parse(content.toString("utf8")),
      content_sha256: hashValue(content),
      modified_at: metadata.mtime.toISOString(),
    };
  } catch (error) {
    throw new Error(`Cannot read JSON ${file}: ${error.message}`);
  }
}

function publicState(state) {
  return {
    schema_version: state.schema_version,
    kind: state.kind,
    active: state.active,
    revision: state.revision,
    phase: state.phase,
    phase_entered_at: state.phase_entered_at,
    terminal_state: state.terminal_state,
    lease: state.lease,
    lease_generation: state.lease_generation,
    material_progress_sha256: state.material_progress_sha256 || null,
    task_id: state.task_id,
    task_path: state.task_path,
    contract_version: state.contract_version,
    contract_hash: state.contract_hash,
    goal_intent_sha256: state.goal_intent_sha256,
    completion_target: state.completion_target,
    bead_id: state.bead_id,
    workspace_root: state.workspace_root,
    git_root: state.git_root,
    expected_branch: state.expected_branch,
    candidate_id: state.candidate_id,
    worktree: state.worktree || null,
    current_slice: state.current_slice,
    guards: state.guards,
  };
}

function reconciliationBlockers(context, state, git, policy) {
  const blockers = [];
  if (state.active !== true) blockers.push({ code: "inactive", message: "Reactivate the task before continuing." });
  if (state.contract_hash !== context.contractHash || state.contract_version !== context.task.contract_version) blockers.push({ code: "contract-drift", message: "The active cache does not match the frozen contract; version and re-activate deliberately." });
  if (state.goal_intent_sha256 !== context.goal.intent_sha256) blockers.push({ code: "goal-drift", message: "Reconcile the persistent goal to the canonical goal specification." });
  if (!samePath(state.workspace_root, context.root)) blockers.push({ code: "wrong-workspace", message: `Run from the bound workspace ${state.workspace_root}.` });
  if (state.git_root && (!git.available || !samePath(state.git_root, git.root))) blockers.push({ code: "wrong-worktree", message: `Run from the bound Git worktree ${state.git_root}.` });
  if (state.expected_branch && git.branch !== state.expected_branch) blockers.push({ code: "wrong-branch", message: `Expected branch ${state.expected_branch}, observed ${git.branch || "detached"}.` });
  if (state.candidate_id && git.candidate_id && state.candidate_id !== git.candidate_id) blockers.push({ code: "stale-candidate", message: "The Git candidate changed; re-activate or re-run candidate-bound review and evidence." });
  for (const message of validateOrchestrationPolicy(policy)) blockers.push({ code: "unsafe-policy", message });
  if (state.guards?.halted) blockers.push({ code: state.guards.halt_reason || "continuation-halted", message: state.guards.halt_message || "Continuation is halted until the blocker changes." });
  if (state.pending_approval) blockers.push({ code: "approval-required", message: `Explicit approval is required for ${state.pending_approval}.` });
  return blockers;
}

function expectedRevision(args) {
  if (args["expected-revision"] === undefined || args["expected-revision"] === true) {
    throw new Error("Pass --expected-revision <non-negative-integer> for compare-and-swap mutation.");
  }
  const revision = Number(args["expected-revision"]);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("--expected-revision must be a non-negative integer.");
  return revision;
}

function requireLifecycleState(state) {
  if (!state) throw new Error("No active-task cache exists.");
  if (state.schema_version !== STATE_SCHEMA_VERSION || state.kind !== "derived-cache" || state.authority !== "none") {
    throw new Error("Unsupported or authority-bearing active-task state; deliberately reactivate the derived cache.");
  }
}

function progressSnapshot(context, git, evidence) {
  return {
    contract_hash: context.contractHash,
    candidate_id: git.candidate_id,
    workspace_candidate_sha256: git.workspace_candidate_sha256,
    acceptance: context.task.acceptance.map((criterion) => ({
      id: criterion.id,
      behavior_sha256: hashValue({ surface: criterion.surface, behavior: criterion.behavior }),
    })),
    evidence: evidence.data ? { ...evidence.data, content_sha256: evidence.content_sha256 } : null,
  };
}

function leaseRequest(args) {
  if (!args["lease-owner"] || args["lease-owner"] === true) throw new Error("Pass --lease-owner <controller-id>.");
  if (!args["lease-token"] || args["lease-token"] === true) throw new Error("Pass --lease-token <fencing-token>.");
  return {
    lease_owner: String(args["lease-owner"]),
    lease_token: String(args["lease-token"]),
  };
}


async function commandWorktreeCreate(args) {
  const sourceRoot = path.resolve(String(args.root || process.cwd()));
  const context = await loadTaskContext(sourceRoot, args.task);
  if (!args["goal-intent"] || args["goal-intent"] === true || args["goal-intent"] !== context.goal.intent_sha256) throw new Error("Worktree creation requires the exact canonical --goal-intent after goal reconciliation.");
  if (!args.path || args.path === true) throw new Error("Pass --path <new-worktree-path>.");
  if (!args.branch || args.branch === true) throw new Error("Pass --branch codex/<task-branch>.");
  const branch = String(args.branch);
  if (!/^codex\/[a-zA-Z0-9._/-]+$/.test(branch) || branch.includes("..")) throw new Error("Task-owned worktree branches must use a safe codex/ prefix.");
  const target = path.resolve(String(args.path));
  if (samePath(target, sourceRoot)) throw new Error("Worktree target must differ from the source worktree.");
  if (await exists(target)) throw new Error(`Worktree target already exists: ${target}`);
  const git = await gitBinding(sourceRoot, lifecycleIgnoredPaths(context));
  if (!git.available || !git.candidate_id) throw new Error("Task-owned worktree creation requires a Git repository with a committed base candidate.");
  const base = String(args.base && args.base !== true ? args.base : git.candidate_id);
  const commit = await capture("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: sourceRoot });
  if (commit.exitCode !== 0) throw new Error(`Base is not a Git commit: ${base}`);
  const taskRelative = path.relative(sourceRoot, context.taskPath).replaceAll("\\", "/");
  const tracked = await capture("git", ["ls-tree", "-r", "--name-only", base, "--", taskRelative], { cwd: sourceRoot });
  if (tracked.exitCode !== 0 || !tracked.stdout.split(/\r?\n/).includes(taskRelative)) throw new Error(`Frozen task contract ${taskRelative} is not committed in base ${base}.`);
  const output = {
    schema_version: 1,
    operation: "worktree-create",
    mode: args.apply === true ? "apply" : "preview",
    source_root: sourceRoot,
    target,
    branch,
    base_candidate: base,
    task_id: context.task.task_id,
    contract_hash: context.contractHash,
    goal_intent_sha256: context.goal.intent_sha256,
    command: ["git", "worktree", "add", "-b", branch, target, base],
  };
  if (args.apply === true) {
    const created = await capture("git", ["worktree", "add", "-b", branch, target, base], { cwd: sourceRoot });
    if (created.exitCode !== 0) throw new Error(`Git worktree creation failed: ${created.stderr.trim() || created.stdout.trim()}`);
    const marker = {
      schema_version: 1,
      kind: "task-owned-worktree",
      authority: "none",
      owner_task_id: context.task.task_id,
      source_root: sourceRoot,
      worktree_root: target,
      branch,
      base_candidate: base,
      contract_hash: context.contractHash,
      goal_intent_sha256: context.goal.intent_sha256,
      created_at: new Date().toISOString(),
    };
    const targetHome = existsSync(path.join(target, ".vision")) ? ".vision" : ".agentic";
    await writeJsonAtomic(path.join(target, targetHome, "state", "worktree-owner.json"), marker);
    output.marker = marker;
  }
  if (args.json === true) console.log(JSON.stringify(output, null, 2));
  else console.log(`${output.mode.toUpperCase()} task-owned worktree ${branch} at ${target} from ${base}.`);
}

async function commandActivate(args) {
  if (!args["goal-intent"] || args["goal-intent"] === true) throw new Error("Pass --goal-intent <sha256> after creating or reconciling the exact canonical goal.");
  const root = path.resolve(String(args.root || process.cwd()));
  const context = await loadTaskContext(root, args.task);
  const policy = policyFor(context.config);
  const policyErrors = validateOrchestrationPolicy(policy);
  if (policyErrors.length) throw new Error(`Unsafe orchestration policy:\n- ${policyErrors.join("\n- ")}`);
  if (args["goal-intent"] !== context.goal.intent_sha256) throw new Error("The supplied goal intent does not match the canonical contract-bound goal.");
  if (!SHA256_PATTERN.test(String(args["goal-intent"]))) throw new Error("--goal-intent must be a SHA-256 value.");

  const file = statePath(root);
  const git = await gitBinding(root, lifecycleIgnoredPaths(context));
  let worktree = null;
  if (args.worktree) {
    if (args.worktree === true || !samePath(args.worktree, root)) throw new Error("--worktree must identify the current repository root; run activation from the task-owned worktree.");
    const markerFile = path.join(root, existsSync(path.join(root, ".vision")) ? ".vision" : ".agentic", "state", "worktree-owner.json");
    if (!(await exists(markerFile))) throw new Error("Task-owned worktree marker is missing; create the worktree through worktree-create or omit --worktree.");
    const marker = await readJson(markerFile);
    if (marker.kind !== "task-owned-worktree" || marker.authority !== "none" || marker.owner_task_id !== context.task.task_id || !samePath(marker.worktree_root, root) || marker.branch !== git.branch || marker.contract_hash !== context.contractHash || marker.goal_intent_sha256 !== context.goal.intent_sha256) throw new Error("Task-owned worktree marker does not match the task, contract, goal, root, or branch.");
    worktree = marker;
  }
  const beadId = args.bead && args.bead !== true ? String(args.bead) : context.task.task_id;
  const bead = await beadBinding(root, beadId);
  const now = new Date().toISOString();
  const state = await withLifecycleStateLock(file, async (previous) => {
    if (previous?.active && previous.task_id !== context.task.task_id && args.replace !== true) {
      throw new Error(`Task ${previous.task_id} is already active; pass --replace only after deliberately reconciling durable state.`);
    }
    const sameContract = previous?.task_id === context.task.task_id && previous.contract_hash === context.contractHash;
    const explicitSlice = args.slice && args.slice !== true;
    const phase = explicitSlice ? "implement" : sameContract && previous.schema_version === STATE_SCHEMA_VERSION ? previous.phase : "implement";
    return {
      schema_version: STATE_SCHEMA_VERSION,
      kind: "derived-cache",
      authority: "none",
      active: true,
      revision: sameContract && Number.isInteger(previous.revision) ? previous.revision + 1 : 0,
      phase,
      phase_entered_at: explicitSlice || !sameContract ? now : previous.phase_entered_at || now,
      terminal_state: null,
      lease: null,
      lease_generation: Number(previous?.lease_generation || 0),
      material_progress_sha256: sameContract ? previous.material_progress_sha256 || null : null,
      task_id: context.task.task_id,
      task_path: path.relative(root, context.taskPath).replaceAll("\\", "/"),
      contract_version: context.task.contract_version,
      contract_hash: context.contractHash,
      goal_intent_sha256: context.goal.intent_sha256,
      completion_target: context.goal.completion_target,
      bead_id: beadId,
      workspace_root: root,
      git_root: git.available ? git.root : null,
      expected_branch: args.branch && args.branch !== true ? String(args.branch) : git.branch,
      candidate_id: args.candidate && args.candidate !== true ? String(args.candidate) : null,
      worktree,
      current_slice: explicitSlice
        ? { id: String(args.slice), summary: String(args["slice-summary"] && args["slice-summary"] !== true ? args["slice-summary"] : `Continue bounded slice ${args.slice}.`) }
        : sameContract ? previous.current_slice || null : null,
      pending_approval: null,
      guards: evaluateContinuation(null, {}, policy),
      activated_at: sameContract ? previous.activated_at || now : now,
      refreshed_at: now,
    };
  });
  const output = { ...publicState(state), canonical_goal: context.goal, bead, git, policy, state_file: file };
  console.log(args.json === true ? JSON.stringify(output, null, 2) : `Activated ${state.task_id}; goal ${state.goal_intent_sha256}; Bead ${bead.status}; slice ${state.current_slice?.id || "unselected"}.`);
}

async function commandResume(args) {
  const root = path.resolve(String(args.root || process.cwd()));
  const file = statePath(root);
  if (!(await exists(file))) throw new Error("No derived active-task cache exists. Run activate after research, contract validation, and exact goal creation.");
  const state = await readJson(file);
  requireLifecycleState(state);
  if (args.task && ![state.task_id, state.task_path].includes(String(args.task))) throw new Error(`Active task is ${state.task_id}, not ${args.task}.`);
  const context = await loadTaskContext(root, state.task_path);
  const policy = policyFor(context.config);
  const [git, bead, evidence] = await Promise.all([
    gitBinding(root, lifecycleIgnoredPaths(context)),
    beadBinding(root, state.bead_id),
    loadEvidence(context),
  ]);
  const blockers = reconciliationBlockers(context, state, git, policy);
  if (state.worktree) {
    const markerFile = path.join(root, existsSync(path.join(root, ".vision")) ? ".vision" : ".agentic", "state", "worktree-owner.json");
    if (!(await exists(markerFile))) blockers.push({ code: "worktree-owner-missing", message: "Task-owned worktree marker is missing." });
    else {
      const marker = await readJson(markerFile);
      if (stableStringify(marker) !== stableStringify(state.worktree)) blockers.push({ code: "worktree-owner-drift", message: "Task-owned worktree binding changed after activation." });
    }
  }
  const beadTerminal = bead.available ? terminalForBeadStatus(bead.status) : null;
  if (!bead.available) {
    blockers.push({ code: "beads-unavailable", message: `Durable Beads state for ${state.bead_id} could not be confirmed: ${bead.detail}` });
  } else if (beadTerminal) {
    blockers.push({ code: `bead-${beadTerminal}`, message: `Bead ${state.bead_id} is ${bead.status}; durable work state forbids continuation.` });
  } else if (["closed", "tombstone"].includes(bead.status) && !completionReached(state.completion_target, evidence.data?.overall_status)) {
    blockers.push({ code: "bead-closed-early", message: `Bead ${state.bead_id} is ${bead.status} before the evidence target is met.` });
  }
  if (evidence.data) {
    if (evidence.data.task_id !== context.task.task_id || evidence.data.contract_version !== context.task.contract_version || evidence.data.contract_hash !== context.contractHash) {
      blockers.push({ code: "stale-evidence", message: "Latest evidence is not bound to the current task contract identity." });
    }
    if (evidence.data.candidate_id && git.candidate_id && evidence.data.candidate_id !== git.candidate_id) {
      blockers.push({ code: "stale-evidence-candidate", message: "Latest evidence is bound to a different Git candidate." });
    }
    if (state.phase !== "implement" && evidence.modified_at && Date.parse(evidence.modified_at) < Date.parse(state.phase_entered_at)) {
      blockers.push({ code: "stale-evidence", message: `Latest evidence predates the ${state.phase} phase.` });
    }
  }
  if (state.phase !== "implement" && git.dirty === true) {
    blockers.push({ code: "dirty-worktree", message: `Commit or deliberately rebind the dirty candidate before ${state.phase}.` });
  }
  const nextSlice = selectLifecycleAction({ state, task: context.task, evidence: evidence.data, blockers });
  const terminalState = beadTerminal
    || state.terminal_state?.kind
    || (state.guards?.halted ? "blocked" : null)
    || (completionReached(state.completion_target, evidence.data?.overall_status) && blockers.length === 0 ? "verified" : null);
  const reconciliationStatus = blockers.length
    ? "blocked"
    : terminalState ? "terminal" : nextSlice.kind === "complete" ? "complete" : "ready";
  const output = {
    schema_version: 2,
    task: publicState(state),
    reconciliation: { status: reconciliationStatus, terminal_state: terminalState, blockers },
    bead,
    git,
    evidence: evidence.data ? {
      file: evidence.file,
      overall_status: evidence.data.overall_status,
      contract_hash: evidence.data.contract_hash,
      candidate_id: evidence.data.candidate_id ?? null,
      workspace_fingerprint: evidence.data.workspace_fingerprint ?? null,
      content_sha256: evidence.content_sha256,
      modified_at: evidence.modified_at,
    } : {
      file: evidence.file,
      overall_status: "missing",
      contract_hash: null,
      candidate_id: null,
      workspace_fingerprint: null,
      content_sha256: null,
      modified_at: null,
    },
    next_slice: nextSlice,
  };
  if (args.json === true) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`${state.task_id}: ${output.reconciliation.status}; evidence ${output.evidence.overall_status}; Bead ${bead.status}.`);
    console.log(`NEXT ${nextSlice.id}: ${nextSlice.action}`);
    for (const blocker of blockers) console.log(`BLOCKED ${blocker.code}: ${blocker.message}`);
  }
  if (blockers.length || (terminalState && terminalState !== "verified")) process.exitCode = 2;
}

async function commandLease(args) {
  const root = path.resolve(String(args.root || process.cwd()));
  const file = statePath(root);
  const revision = expectedRevision(args);
  if (!args.owner || args.owner === true) throw new Error("Pass --owner <controller-id>.");
  const ttlMs = args["ttl-ms"] === undefined ? 300_000 : Number(args["ttl-ms"]);
  const token = args.token && args.token !== true ? String(args.token) : randomBytes(24).toString("hex");
  const state = await withLifecycleStateLock(file, async (current) => {
    requireLifecycleState(current);
    const next = acquireLifecycleLease(current, {
      expected_revision: revision,
      owner: String(args.owner),
      token,
      now_ms: Date.now(),
      ttl_ms: ttlMs,
    });
    next.refreshed_at = new Date().toISOString();
    return next;
  });
  const output = { task_id: state.task_id, revision: state.revision, phase: state.phase, current_slice: state.current_slice, lease: state.lease };
  console.log(args.json === true ? JSON.stringify(output, null, 2) : `${state.task_id}: leased ${state.current_slice?.id || state.phase} to ${state.lease.owner} at revision ${state.revision}.`);
}

async function commandCheckpoint(args) {
  const root = path.resolve(String(args.root || process.cwd()));
  const file = statePath(root);
  if (args.progress !== undefined) throw new Error("Material progress is derived from candidate, evidence, and acceptance fingerprints; --progress is not accepted.");
  const revision = expectedRevision(args);
  const lease = leaseRequest(args);
  const contextPercent = args["context-percent"] === undefined ? undefined : Number(args["context-percent"]);
  if (contextPercent !== undefined && (!Number.isFinite(contextPercent) || contextPercent < 0 || contextPercent > 100)) throw new Error("--context-percent must be from 0 to 100.");
  if (args.terminal === true) throw new Error("Pass --terminal <typed-terminal-state>.");
  if (args.phase === true) throw new Error("Pass --phase <lifecycle-phase>.");
  const state = await withLifecycleStateLock(file, async (current) => {
    requireLifecycleState(current);
    const context = await loadTaskContext(root, current.task_path);
    const policy = policyFor(context.config);
    const [git, evidence] = await Promise.all([gitBinding(root, lifecycleIgnoredPaths(context)), loadEvidence(context)]);
    const progress = deriveMaterialProgressFingerprint(progressSnapshot(context, git, evidence));
    const guards = evaluateContinuation(current.guards, {
      progress_sha256: progress,
      authorization_failure_sha256: args["authorization-failure"] && args["authorization-failure"] !== true ? hashValue(String(args["authorization-failure"])) : null,
      clear_authorization_failure: args["clear-authorization-failure"] === true,
      context_percent: contextPercent,
      run_id: args["run-id"] && args["run-id"] !== true ? String(args["run-id"]) : null,
      finish_run: args["finish-run"] === true,
    }, policy);
    const explicitSlice = args.slice && args.slice !== true;
    const phase = args.phase && args.phase !== true
      ? String(args.phase)
      : args["complete-slice"] === true ? "verify" : explicitSlice ? "implement" : current.phase;
    const requestedTerminal = args.terminal && args.terminal !== true ? String(args.terminal) : null;
    const terminal = requestedTerminal || (guards.halted ? "blocked" : null);
    if (terminal === "verified") {
      if (!completionReached(current.completion_target, evidence.data?.overall_status)) throw new Error("Verified terminal state requires current evidence at the declared completion target.");
      if (git.dirty === true) throw new Error("Verified terminal state rejects a dirty Git worktree.");
      if (evidence.data?.contract_hash !== context.contractHash) throw new Error("Verified terminal state requires current contract-bound evidence.");
    }
    const transition = {
      expected_revision: revision,
      ...lease,
      now_ms: Date.now(),
      phase,
      guards,
      progress_sha256: progress,
      release_lease: args["release-lease"] === true || args["complete-slice"] === true || Boolean(terminal),
      ...(terminal ? {
        terminal_state: terminal,
        terminal_reason: String(args["terminal-reason"] && args["terminal-reason"] !== true ? args["terminal-reason"] : guards.halt_message || `Lifecycle ended as ${terminal}.`),
      } : {}),
      ...(explicitSlice ? {
        current_slice: {
          id: String(args.slice),
          summary: String(args["slice-summary"] && args["slice-summary"] !== true ? args["slice-summary"] : `Continue bounded slice ${args.slice}.`),
        },
      } : args["complete-slice"] === true ? { current_slice: null } : {}),
      ...(args["pending-approval"] && args["pending-approval"] !== true ? { pending_approval: String(args["pending-approval"]) } : {}),
      ...(args["clear-approval"] === true ? { pending_approval: null } : {}),
    };
    const next = transitionLifecycle(current, transition);
    next.refreshed_at = new Date().toISOString();
    return next;
  });
  const output = { task_id: state.task_id, revision: state.revision, phase: state.phase, terminal_state: state.terminal_state, lease: state.lease, current_slice: state.current_slice, pending_approval: state.pending_approval, material_progress_sha256: state.material_progress_sha256, guards: state.guards };
  console.log(args.json === true ? JSON.stringify(output, null, 2) : `${state.task_id}: ${state.guards.halted ? `HALT ${state.guards.halt_reason}` : "continue"}.`);
  if (state.guards.halted || (state.terminal_state && state.terminal_state.kind !== "verified")) process.exitCode = 2;
}

async function commandDeactivate(args) {
  const root = path.resolve(String(args.root || process.cwd()));
  const file = statePath(root);
  const revision = expectedRevision(args);
  const lease = leaseRequest(args);
  const state = await withLifecycleStateLock(file, async (current) => {
    requireLifecycleState(current);
    if (args.task && String(args.task) !== current.task_id) throw new Error(`Active task is ${current.task_id}, not ${args.task}.`);
    const next = transitionLifecycle(current, {
      expected_revision: revision,
      ...lease,
      now_ms: Date.now(),
      release_lease: true,
    });
    next.active = false;
    next.deactivated_at = new Date().toISOString();
    next.deactivation_reason = String(args.reason && args.reason !== true ? args.reason : "explicit-deactivation");
    return next;
  });
  console.log(args.json === true ? JSON.stringify(publicState(state), null, 2) : `Deactivated derived cache for ${state.task_id}; durable contract and Beads state were preserved.`);
}

export function redactContext(value) {
  const lines = String(value || "").split(/\r?\n/);
  return lines.map((line) => SECRET_LINE_PATTERN.test(line) ? "[REDACTED SECRET-LIKE LINE]" : line).join("\n").slice(0, MAX_CONTEXT_BYTES);
}

async function buildContextText(root, state, event) {
  const contextFile = path.join(root, existsSync(path.join(root, ".vision")) ? ".vision" : ".agentic", "project-context.md");
  const projectContext = (await exists(contextFile)) ? redactContext(await fs.readFile(contextFile, "utf8")) : "";
  const active = state?.active ? [
    `Active Vision task: ${state.task_id} contract v${state.contract_version}.`,
    `Canonical goal intent: ${state.goal_intent_sha256}; stop only at ${state.completion_target}.`,
    `Bead: ${state.bead_id}; bound workspace: ${state.workspace_root}.`,
    state.current_slice ? `Current bounded slice: ${state.current_slice.id} - ${state.current_slice.summary}` : "No implementation slice is selected; run agentic-lifecycle resume for exactly one next slice.",
    "The active-task file is derived cache only. The frozen contract and Beads remain authoritative; builder-side agents and hooks cannot create closure evidence or grant approvals.",
  ].join("\n") : "No active Vision task cache is present. Research and validate a schema-v3 contract before creating a persistent goal or activating lifecycle state.";
  const eventBoundary = event === "SubagentStart" ? "Subagent boundary: remain read-only when scouting; do not recurse, create goals, mutate Beads, approve actions, or claim independent verification. Reviewer output is advisory builder-side evidence only." : "";
  return redactContext([projectContext, active, eventBoundary].filter(Boolean).join("\n\n"));
}

async function readStdinLimited() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_HOOK_INPUT_BYTES) throw new Error("Hook input exceeded 1 MiB.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function commandHook() {
  const input = await readStdinLimited();
  const event = String(input.hook_event_name || input.event || input.event_name || "SessionStart");
  const root = path.resolve(String(input.cwd || process.cwd()));
  const configFile = existsSync(path.join(root, ".vision", "config.json")) ? path.join(root, ".vision", "config.json") : path.join(root, ".agentic", "config.json");
  const hasProjectConfig = await exists(configFile);
  if (!hasProjectConfig && event !== "UserPromptSubmit") return;
  const config = hasProjectConfig ? await readJson(configFile) : null;
  if (config?.orchestration?.hooks?.enabled === false) return;
  const file = statePath(root);
  const state = hasProjectConfig && (await exists(file)) ? await readJson(file) : null;
  let additionalContext = hasProjectConfig ? await buildContextText(root, state, event) : "";
  let systemMessage = "";
  if (event === "UserPromptSubmit") {
    if (!state?.active && config?.orchestration?.hooks?.offer_vision_on_engineering_outcome !== false) {
      const prompt = [input.prompt, input.user_prompt, input.userPrompt].find((value) => typeof value === "string") || "";
      const classification = classifyVisionOffer(prompt);
      if (classification.offer) {
        const offerContext = [
          "Vision advisory: this looks like a new engineering outcome, but Vision was not explicitly invoked.",
          "Before editing or beginning implementation, ask exactly one concise question: \"Use Vision to drive this end to end to locally-verified?\"",
          "If the user agrees, explicitly use the installed vision:vision skill with the original outcome. If they decline, continue normally.",
          "This is an advisory routing suggestion only. It does not create a goal, grant approval, broaden authority, or authorize external actions.",
        ].join("\n");
        additionalContext = redactContext([additionalContext, offerContext].filter(Boolean).join("\n\n"));
        systemMessage = "Vision is available for this engineering outcome; ask once whether to use it end to end before editing.";
      }
    }
    if (!state?.active && !systemMessage) return;
  }
  const hookSpecificOutput = { hookEventName: event, additionalContext };
  if (event === "Stop") {
    console.log(JSON.stringify({ continue: true, suppressOutput: true, systemMessage: state?.active ? `Vision ${state.task_id} remains active. This advisory hook does not force continuation or override an explicit stop; resume only when authorized and use the frozen contract.` : "", hookSpecificOutput }));
    return;
  }
  console.log(JSON.stringify({ continue: true, suppressOutput: true, systemMessage, hookSpecificOutput }));
}

async function commandContext(args) {
  const root = path.resolve(String(args.root || process.cwd()));
  const file = statePath(root);
  const state = (await exists(file)) ? await readJson(file) : null;
  const value = await buildContextText(root, state, "Context");
  console.log(args.json === true ? JSON.stringify({ context: value }, null, 2) : value);
}

function printHelp() {
  console.log(`Vision lifecycle

Commands:
  worktree-create --task id-or-path --goal-intent sha256 --path new-path --branch codex/name [--base commit] [--apply] [--json]
  activate --task id-or-path --goal-intent sha256 [--bead id] [--slice id] [--slice-summary text] [--worktree path] [--branch name] [--candidate sha] [--replace] [--json]
  resume [--task id-or-path] [--json]
  lease --owner controller-id --expected-revision n [--token token] [--ttl-ms n] [--json]
  checkpoint --expected-revision n --lease-owner id --lease-token token [--phase phase] [--authorization-failure signature] [--clear-authorization-failure] [--context-percent n] [--run-id id] [--finish-run] [--slice id] [--slice-summary text] [--complete-slice] [--release-lease] [--terminal state] [--terminal-reason text] [--pending-approval action] [--clear-approval] [--json]
  context [--json]
  deactivate --expected-revision n --lease-owner id --lease-token token [--task id] [--reason text] [--json]
  hook

The lifecycle file is a rebuildable, authority-neutral cache. It cannot create a goal, approve an action, mutate Beads, merge, deploy, or promote verification state.
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || command === "help" || args.help) return printHelp();
  if (command === "worktree-create") return commandWorktreeCreate(args);
  if (command === "activate") return commandActivate(args);
  if (command === "resume") return commandResume(args);
  if (command === "lease") return commandLease(args);
  if (command === "checkpoint") return commandCheckpoint(args);
  if (command === "context") return commandContext(args);
  if (command === "deactivate") return commandDeactivate(args);
  if (command === "hook") return commandHook();
  throw new Error(`Unknown command: ${command}`);
}

async function sameFile(left, right) {
  try {
    const [realLeft, realRight] = await Promise.all([fs.realpath(left), fs.realpath(right)]);
    return samePath(realLeft, realRight);
  } catch {
    return samePath(left, right);
  }
}

const isEntrypoint = process.argv[1] && await sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
