#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const STAGES = new Set(["fast", "integration", "ui", "post-deploy"]);
const PROFILE_KINDS = new Set(["mocked", "local-real", "mixed", "staging", "production"]);
const MOCK_POLICIES = new Set(["allow-first-party", "forbid-first-party", "not-applicable"]);
const SURFACES = new Set(["logic", "api", "data", "async", "ui", "cli", "infra", "ops", "security", "performance"]);
const TASK_SCHEMA_VERSIONS = new Set([2, 3]);
const RESEARCH_MODES = new Set(["direct", "scouted", "fallback"]);
const RESEARCH_STATUSES = new Set(["resolved", "not-applicable", "deferred"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const SUBAGENT_CAPABILITIES = new Set(["available", "unavailable"]);
const GOAL_CAPABILITIES = new Set(["authorized", "not-authorized", "unavailable"]);
const GOAL_PERSISTENCE = new Set(["goal-tool", "existing-goal", "contract-fallback"]);
const COMPLETION_STATES = new Set(["implemented-not-verified", "locally-verified", "closure-verified", "delivered-and-verified"]);
const VERIFIER_PURPOSE = "agentic-delivery-closure";
const VERIFIER_ALGORITHM = "Ed25519";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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
    const value = next && !next.startsWith("--") ? argv[++index] : true;
    if (key === "image") {
      parsed.image ??= [];
      parsed.image.push(value);
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashValue(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
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

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function expandString(value, env) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (match, key) => {
    if (env[key] === undefined) throw new Error(`Required variable ${key} is not set while expanding ${value}`);
    return String(env[key]);
  });
}

function expandObject(value, env) {
  if (typeof value === "string") return expandString(value, env);
  if (Array.isArray(value)) return value.map((item) => expandObject(item, env));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandObject(item, env)]));
  }
  return value;
}

function applyAuthorityEnvironment(config, env = process.env) {
  if (!env.AGENTIC_AUTHORITY_MODE) return config;
  const trust = {
    ...(config.authority?.trust || {}),
    ...(env.AGENTIC_VERIFIER_ISSUER ? { issuer: env.AGENTIC_VERIFIER_ISSUER } : {}),
    ...(env.AGENTIC_VERIFIER_REPOSITORY ? { repository: env.AGENTIC_VERIFIER_REPOSITORY } : {}),
    ...(env.AGENTIC_VERIFIER_WORKFLOW_REF ? { workflow_ref: env.AGENTIC_VERIFIER_WORKFLOW_REF } : {}),
    ...(env.AGENTIC_VERIFIER_PUBLIC_KEY ? { public_key: env.AGENTIC_VERIFIER_PUBLIC_KEY, public_key_file: undefined } : {}),
    ...(env.AGENTIC_VERIFIER_PUBLIC_KEY_FILE ? { public_key_file: env.AGENTIC_VERIFIER_PUBLIC_KEY_FILE, public_key: undefined } : {}),
  };
  return {
    ...config,
    authority: {
      ...(config.authority || {}),
      mode: env.AGENTIC_AUTHORITY_MODE,
      ...(env.AGENTIC_VERIFIER_ID ? { verifier_id: env.AGENTIC_VERIFIER_ID } : {}),
      trust,
    },
  };
}

async function resolveTaskPath(root, taskArg) {
  if (!taskArg) throw new Error("Pass --task <task-id-or-json-path>.");
  const direct = path.resolve(root, taskArg);
  if (await exists(direct)) return direct;
  const named = path.resolve(root, ".agentic", "tasks", taskArg.endsWith(".json") ? taskArg : `${taskArg}.json`);
  if (await exists(named)) return named;
  throw new Error(`Task contract not found: ${taskArg}`);
}

async function loadContext(args) {
  const root = path.resolve(String(args.root || process.cwd()));
  const configPath = path.resolve(root, String(args.config || ".agentic/config.json"));
  if (!(await exists(configPath))) throw new Error(`Configuration not found: ${configPath}`);
  const config = applyAuthorityEnvironment(await readJson(configPath));
  validateConfig(config);
  const taskPath = await resolveTaskPath(root, args.task);
  const task = await readJson(taskPath);
  const errors = validateTask(task, config);
  return { root, configPath, config, taskPath, task, errors };
}

export function validateConfig(config) {
  const errors = [];
  if (config.schema_version !== 2) errors.push("config.schema_version must be 2");
  if (!config.authority || !["local", "verifier"].includes(config.authority.mode)) errors.push("config.authority.mode must be local or verifier");
  if (config.authority?.mode === "verifier") {
    if (!config.authority.verifier_id || typeof config.authority.verifier_id !== "string") errors.push("verifier authority requires authority.verifier_id");
    if (!config.authority.trust?.issuer || typeof config.authority.trust.issuer !== "string") errors.push("verifier authority requires authority.trust.issuer");
    if (!config.authority.trust?.public_key && !config.authority.trust?.public_key_file) errors.push("verifier authority requires a trusted Ed25519 public key");
    const maximum = Number(config.authority.trust?.max_grant_ttl_seconds || 900);
    if (!Number.isFinite(maximum) || maximum < 60 || maximum > 86400) errors.push("authority.trust.max_grant_ttl_seconds must be between 60 and 86400");
  }
  if (!config.profiles || typeof config.profiles !== "object") errors.push("config.profiles must be an object");
  for (const [name, profile] of Object.entries(config.profiles || {})) {
    if (profile.enabled === false) continue;
    if (!PROFILE_KINDS.has(profile.kind)) errors.push(`profile ${name} has invalid kind`);
    if (!MOCK_POLICIES.has(profile.mock_policy)) errors.push(`profile ${name} has invalid mock_policy`);
    if ((profile.kind === "local-real" || profile.kind === "mixed" || profile.kind === "staging" || profile.kind === "production") && !profile.api_origin) {
      errors.push(`profile ${name} requires api_origin`);
    }
    if ((profile.kind === "staging" || profile.kind === "production") && !profile.external) {
      errors.push(`profile ${name} must set external=true`);
    }
    if (profile.kind === "production" && !profile.requires_approval) {
      errors.push(`production profile ${name} must set requires_approval=true`);
    }
  }
  if (errors.length) throw new Error(`Invalid .agentic/config.json:\n- ${errors.join("\n- ")}`);
}

export function validateTask(task, config) {
  const errors = [];
  if (!TASK_SCHEMA_VERSIONS.has(task.schema_version)) errors.push("task.schema_version must be 2 or 3");
  if (!Number.isInteger(task.contract_version) || task.contract_version < 1) errors.push("task.contract_version must be a positive integer");
  if (!task.task_id) errors.push("task.task_id is required");
  if (!["S", "M", "L"].includes(task.planning?.size)) errors.push("planning.size must be S, M, or L");
  if (!Array.isArray(task.risk_flags)) errors.push("task.risk_flags must be an array");
  if (!Array.isArray(task.acceptance) || task.acceptance.length === 0) errors.push("task.acceptance must contain at least one criterion");
  if (!Array.isArray(task.checks) || task.checks.length === 0) errors.push("task.checks must contain at least one check");

  const criteria = new Map();
  for (const criterion of task.acceptance || []) {
    if (!criterion.id) errors.push("every acceptance criterion requires an id");
    if (criteria.has(criterion.id)) errors.push(`duplicate acceptance id ${criterion.id}`);
    if (!SURFACES.has(criterion.surface)) errors.push(`criterion ${criterion.id} has invalid surface`);
    if (!criterion.behavior) errors.push(`criterion ${criterion.id} requires observable behavior`);
    criteria.set(criterion.id, criterion);
  }

  const checks = new Map();
  for (const check of task.checks || []) {
    if (!check.id) errors.push("every check requires an id");
    if (checks.has(check.id)) errors.push(`duplicate check id ${check.id}`);
    checks.set(check.id, check);
    if (!STAGES.has(check.stage)) errors.push(`check ${check.id} has invalid stage`);
    if (!check.command || typeof check.command !== "string") errors.push(`check ${check.id} requires a command`);
    if (!check.claim_scope || typeof check.claim_scope !== "string") errors.push(`check ${check.id} requires claim_scope`);
    if (check.artifacts?.test_integrity && (!Array.isArray(check.expected_tests) || check.expected_tests.length === 0)) errors.push(`check ${check.id} requires expected_tests when test_integrity is enabled`);
    if (check.artifacts?.system_attestation) {
      const adapter = check.artifacts.system_attestation;
      if (!adapter.kind || typeof adapter.kind !== "string") errors.push(`check ${check.id} system_attestation requires kind`);
      if (!Array.isArray(adapter.required_assertions) || adapter.required_assertions.length === 0) errors.push(`check ${check.id} system_attestation requires required_assertions`);
      if (!["integration", "post-deploy"].includes(check.stage)) errors.push(`check ${check.id} system_attestation requires integration or post-deploy stage`);
    }
    if (!Array.isArray(check.criterion_ids) || check.criterion_ids.length === 0) errors.push(`check ${check.id} requires criterion_ids`);
    for (const id of check.criterion_ids || []) {
      if (!criteria.has(id)) errors.push(`check ${check.id} references unknown criterion ${id}`);
    }
    if (check.profile) {
      const profile = config.profiles?.[check.profile];
      if (!profile) errors.push(`check ${check.id} references unknown profile ${check.profile}`);
      else if (profile.enabled === false) errors.push(`check ${check.id} references disabled profile ${check.profile}`);
      if (profile?.kind === "production" && check.safe_for_live !== true) errors.push(`production check ${check.id} must set safe_for_live=true`);
      if (check.artifacts?.business_flow_provenance) {
        if (!check.business_request?.path) errors.push(`check ${check.id} requires business_request.path for business-flow provenance`);
        if (!profile?.provenance?.correlation_url || !profile?.provenance?.deployment_id) errors.push(`profile ${check.profile} requires provenance correlation_url and deployment_id`);
      }
    } else if (check.stage === "ui" || check.stage === "post-deploy") {
      errors.push(`check ${check.id} requires an environment profile`);
    }
  }

  for (const criterion of criteria.values()) {
    const requiredChecks = (task.checks || []).filter((check) => check.required !== false && check.criterion_ids?.includes(criterion.id));
    if (requiredChecks.length === 0) errors.push(`criterion ${criterion.id} has no required check`);
    if (criterion.surface === "ui") {
      const firstPartyRisk = (task.risk_flags || []).some((risk) => ["api-contract", "auth", "tenant", "external-integration", "runtime-config", "deployment"].includes(risk));
      const realUi = requiredChecks.find((check) => {
        const profile = config.profiles?.[check.profile];
        return (check.stage === "ui" || check.stage === "post-deploy") && profile?.mock_policy === "forbid-first-party" && check.artifacts?.attestation === true && check.artifacts?.test_integrity === true && (!firstPartyRisk || check.artifacts?.business_flow_provenance === true);
      });
      if (!realUi) errors.push(`UI criterion ${criterion.id} requires a real-service UI check with runtime attestation and test-integrity evidence`);
      if ((task.risk_flags || []).includes("visual")) {
        const visual = requiredChecks.find((check) => Number(check.artifacts?.screenshots_min || 0) >= 1 && check.artifacts?.visual_review === true);
        if (!visual) errors.push(`visual UI criterion ${criterion.id} requires final-state screenshot and visual-review evidence`);
      }
    }
    if (criterion.surface === "data" && (task.risk_flags || []).some((risk) => ["persistence", "migration"].includes(risk))) {
      const dataGate = requiredChecks.find((check) => ["data", "migration"].includes(check.artifacts?.system_attestation?.kind));
      if (!dataGate) errors.push(`data criterion ${criterion.id} requires a data or migration system-attestation check`);
    }
    if (criterion.surface === "async" && (task.risk_flags || []).includes("async")) {
      const asyncGate = requiredChecks.find((check) => check.artifacts?.system_attestation?.kind === "async");
      if (!asyncGate) errors.push(`async criterion ${criterion.id} requires an async system-attestation check`);
    }
  }
  if ((task.risk_flags || []).includes("migration") && !(task.checks || []).some((check) => check.required !== false && check.artifacts?.system_attestation?.kind === "migration")) {
    errors.push("migration risk requires a required migration system-attestation check");
  }
  if ((task.risk_flags || []).includes("async") && !(task.checks || []).some((check) => check.required !== false && check.artifacts?.system_attestation?.kind === "async")) {
    errors.push("async risk requires a required async system-attestation check");
  }
  if (task.schema_version === 3) validateDiscoveryBootstrap(task, errors);
  return errors;
}

function hasExactStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) return false;
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return actual.length === actualSet.size && actualSet.size === expectedSet.size && [...actualSet].every((value) => expectedSet.has(value));
}

function requireStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) errors.push(`${label} must be an array of non-empty strings`);
}

function validateDiscoveryBootstrap(task, errors) {
  const intake = task.intake;
  const goal = task.goal_spec;
  if (!intake || typeof intake !== "object" || Array.isArray(intake)) {
    errors.push("task schema 3 requires intake");
    return;
  }
  if (intake.status !== "ready") errors.push("intake.status must be ready before the contract can run");
  if (!RESEARCH_MODES.has(intake.research_mode)) errors.push("intake.research_mode must be direct, scouted, or fallback");
  if (typeof intake.mode_reason !== "string" || !intake.mode_reason.trim()) errors.push("intake.mode_reason is required");

  const capabilities = intake.capabilities;
  if (!capabilities || typeof capabilities !== "object") errors.push("intake.capabilities is required");
  if (!SUBAGENT_CAPABILITIES.has(capabilities?.subagents)) errors.push("intake.capabilities.subagents must be available or unavailable");
  if (!GOAL_CAPABILITIES.has(capabilities?.goal)) errors.push("intake.capabilities.goal must be authorized, not-authorized, or unavailable");

  if (!Array.isArray(intake.questions) || intake.questions.length === 0) errors.push("intake.questions must contain at least one bounded research question");
  const questionList = Array.isArray(intake.questions) ? intake.questions : [];
  const questions = new Map();
  for (const question of questionList) {
    if (!question.id || typeof question.id !== "string") errors.push("every intake question requires an id");
    else if (questions.has(question.id)) errors.push(`duplicate intake question ${question.id}`);
    else questions.set(question.id, question);
    if (typeof question.question !== "string" || !question.question.trim()) errors.push(`intake question ${question.id || "<unknown>"} requires question text`);
    if (typeof question.material !== "boolean") errors.push(`intake question ${question.id || "<unknown>"} requires material=true or false`);
    if (!RESEARCH_STATUSES.has(question.status)) errors.push(`intake question ${question.id || "<unknown>"} has invalid status`);
    if (question.material === true && question.status !== "resolved") errors.push(`material intake question ${question.id || "<unknown>"} must be resolved`);
    if (typeof question.conclusion !== "string" || !question.conclusion.trim()) errors.push(`intake question ${question.id || "<unknown>"} requires a concise conclusion`);
    if (!CONFIDENCE_LEVELS.has(question.confidence)) errors.push(`intake question ${question.id || "<unknown>"} has invalid confidence`);
    requireStringArray(question.evidence_refs, `intake question ${question.id || "<unknown>"} evidence_refs`, errors);
    if (Array.isArray(question.evidence_refs) && question.evidence_refs.length === 0) errors.push(`intake question ${question.id || "<unknown>"} requires at least one evidence reference`);
  }

  if (!Array.isArray(intake.scouts)) errors.push("intake.scouts must be an array");
  const scoutList = Array.isArray(intake.scouts) ? intake.scouts : [];
  if (intake.research_mode === "direct" && scoutList.length > 0) errors.push("direct intake must not claim scout results");
  if (intake.research_mode === "scouted") {
    if (capabilities?.subagents !== "available") errors.push("scouted intake requires available subagents");
    if (scoutList.length === 0) errors.push("scouted intake requires at least one completed scout");
  }
  if (intake.research_mode === "fallback") {
    if (capabilities?.subagents !== "unavailable") errors.push("fallback intake requires unavailable subagents");
    if (typeof intake.fallback_reason !== "string" || !intake.fallback_reason.trim()) errors.push("fallback intake requires fallback_reason");
    if (scoutList.length > 0) errors.push("fallback intake must not claim scout results");
  }
  const scouts = new Set();
  for (const scout of scoutList) {
    if (!scout.id || typeof scout.id !== "string") errors.push("every intake scout requires an id");
    else if (scouts.has(scout.id)) errors.push(`duplicate intake scout ${scout.id}`);
    else scouts.add(scout.id);
    if (scout.scope !== "read-only") errors.push(`intake scout ${scout.id || "<unknown>"} scope must be read-only`);
    if (scout.status !== "complete") errors.push(`intake scout ${scout.id || "<unknown>"} status must be complete`);
    if (typeof scout.summary !== "string" || !scout.summary.trim()) errors.push(`intake scout ${scout.id || "<unknown>"} requires a concise summary`);
    requireStringArray(scout.question_ids, `intake scout ${scout.id || "<unknown>"} question_ids`, errors);
    if (Array.isArray(scout.question_ids) && scout.question_ids.length === 0) errors.push(`intake scout ${scout.id || "<unknown>"} requires at least one question id`);
    for (const questionId of scout.question_ids || []) {
      if (!questions.has(questionId)) errors.push(`intake scout ${scout.id || "<unknown>"} references unknown question ${questionId}`);
    }
    requireStringArray(scout.evidence_refs, `intake scout ${scout.id || "<unknown>"} evidence_refs`, errors);
    if (Array.isArray(scout.evidence_refs) && scout.evidence_refs.length === 0) errors.push(`intake scout ${scout.id || "<unknown>"} requires at least one evidence reference`);
    for (const forbidden of ["raw", "raw_output", "transcript", "logs", "secrets"]) {
      if (Object.hasOwn(scout, forbidden)) errors.push(`intake scout ${scout.id || "<unknown>"} must not embed ${forbidden}`);
    }
  }

  if (!Array.isArray(intake.conflicts)) errors.push("intake.conflicts must be an array");
  const conflictList = Array.isArray(intake.conflicts) ? intake.conflicts : [];
  for (const conflict of conflictList) {
    if (!conflict.id || typeof conflict.id !== "string") errors.push("every intake conflict requires an id");
    if (conflict.status !== "resolved") errors.push(`intake conflict ${conflict.id || "<unknown>"} must be resolved`);
    if (typeof conflict.resolution !== "string" || !conflict.resolution.trim()) errors.push(`intake conflict ${conflict.id || "<unknown>"} requires a resolution`);
    if (typeof conflict.source !== "string" || !conflict.source.trim()) errors.push(`intake conflict ${conflict.id || "<unknown>"} requires a decision source`);
  }

  if (!Array.isArray(intake.assumptions)) errors.push("intake.assumptions must be an array");
  const assumptionList = Array.isArray(intake.assumptions) ? intake.assumptions : [];
  for (const assumption of assumptionList) {
    if (!assumption.id || typeof assumption.id !== "string") errors.push("every intake assumption requires an id");
    if (typeof assumption.statement !== "string" || !assumption.statement.trim()) errors.push(`intake assumption ${assumption.id || "<unknown>"} requires a statement`);
    if (assumption.material !== false) errors.push(`intake assumption ${assumption.id || "<unknown>"} must be explicitly non-material`);
    if (assumption.reversible !== true) errors.push(`intake assumption ${assumption.id || "<unknown>"} must be reversible`);
  }
  requireStringArray(intake.unresolved_material, "intake.unresolved_material", errors);
  if (Array.isArray(intake.unresolved_material) && intake.unresolved_material.length > 0) errors.push("intake.unresolved_material must be empty before the contract can run");

  const synthesis = intake.synthesis;
  if (!synthesis || typeof synthesis !== "object") errors.push("intake.synthesis is required");
  if (typeof synthesis?.outcome !== "string" || !synthesis.outcome.trim()) errors.push("intake.synthesis.outcome is required");
  for (const field of ["requirements", "constraints", "non_goals", "risk_flags", "acceptance_ids"]) {
    requireStringArray(synthesis?.[field], `intake.synthesis.${field}`, errors);
  }
  if (Array.isArray(synthesis?.requirements) && synthesis.requirements.length === 0) errors.push("intake.synthesis.requirements must contain at least one requirement");
  if (!hasExactStringSet(synthesis?.risk_flags, task.risk_flags || [])) errors.push("intake.synthesis.risk_flags must exactly match task.risk_flags");
  const acceptanceIds = (task.acceptance || []).map((criterion) => criterion.id).filter(Boolean);
  if (!hasExactStringSet(synthesis?.acceptance_ids, acceptanceIds)) errors.push("intake.synthesis.acceptance_ids must exactly match task acceptance ids");

  if (!goal || typeof goal !== "object" || Array.isArray(goal)) {
    errors.push("task schema 3 requires goal_spec");
    return;
  }
  if (typeof goal.objective !== "string" || !goal.objective.trim()) errors.push("goal_spec.objective is required");
  if (typeof goal.objective === "string" && typeof synthesis?.outcome === "string" && goal.objective.trim() !== synthesis.outcome.trim()) errors.push("goal_spec.objective must exactly match intake.synthesis.outcome");
  if (!hasExactStringSet(goal.acceptance_ids, acceptanceIds)) errors.push("goal_spec.acceptance_ids must exactly match task acceptance ids");
  if (!COMPLETION_STATES.has(goal.completion_target)) errors.push("goal_spec.completion_target must be an honest framework completion state");
  if (!GOAL_PERSISTENCE.has(goal.persistence)) errors.push("goal_spec.persistence must be goal-tool, existing-goal, or contract-fallback");
  if (typeof goal.mechanism !== "string" || !goal.mechanism.trim()) errors.push("goal_spec.mechanism is required");
  if (capabilities?.goal === "authorized" && !["goal-tool", "existing-goal"].includes(goal.persistence)) errors.push("authorized goal capability requires goal-tool or existing-goal persistence");
  if (["not-authorized", "unavailable"].includes(capabilities?.goal) && goal.persistence !== "contract-fallback") errors.push("unavailable or unauthorized goal capability requires contract-fallback persistence");
  if (goal.persistence === "contract-fallback" && (typeof goal.fallback_reason !== "string" || !goal.fallback_reason.trim())) errors.push("contract-fallback goal persistence requires fallback_reason");
}

export function buildGoalSpec(task) {
  if (task.schema_version !== 3 || !task.goal_spec) throw new Error("goal-spec requires a task schema 3 contract with goal_spec");
  const acceptanceIds = [...task.goal_spec.acceptance_ids].sort();
  const objective = `${task.goal_spec.objective.trim()} Work against task ${task.task_id} contract v${task.contract_version}; satisfy ${acceptanceIds.join(", ")} and stop only at ${task.goal_spec.completion_target}. Do not weaken the frozen contract or its verification gates.`;
  return {
    schema_version: 1,
    task_id: task.task_id,
    contract_version: task.contract_version,
    completion_target: task.goal_spec.completion_target,
    acceptance_ids: acceptanceIds,
    objective,
    intent_sha256: hashValue({ task_id: task.task_id, contract_version: task.contract_version, completion_target: task.goal_spec.completion_target, acceptance_ids: acceptanceIds, objective }),
  };
}

async function capture(command, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ exitCode: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? -1, stdout, stderr }));
  });
}

async function workspaceFingerprint(root, evidenceRoot) {
  const ignored = [evidenceRoot.replaceAll("\\", "/"), ".git/", "node_modules/", ".playwright-browsers/", ".npm-cache/", ".uv-cache/", "test-results/", "playwright-report/"];
  const safeRoot = root.replaceAll("\\", "/").replaceAll('"', '\\"');
  const git = `git -c safe.directory="${safeRoot}"`;
  const gitRoot = await capture(`${git} rev-parse --show-toplevel`, { cwd: root, env: process.env });
  if (gitRoot.exitCode !== 0) {
    const files = [];
    for (const file of await walkFiles(root)) {
      const relative = path.relative(root, file).replaceAll("\\", "/");
      if (ignored.some((prefix) => relative.startsWith(prefix))) continue;
      const stat = await fs.stat(file);
      files.push([relative, stat.size <= 5_000_000 ? hashValue(await fs.readFile(file)) : `large:${stat.size}:${stat.mtimeMs}`]);
    }
    return hashValue({ mode: "filesystem", files });
  }
  const head = await capture(`${git} rev-parse HEAD`, { cwd: root, env: process.env });
  const status = await capture(`${git} status --porcelain=v1 --untracked-files=all`, { cwd: root, env: process.env });
  const diff = await capture(`${git} diff --binary --no-ext-diff`, { cwd: root, env: process.env });
  const staged = await capture(`${git} diff --binary --cached --no-ext-diff`, { cwd: root, env: process.env });
  const statusLines = status.stdout.split(/\r?\n/).filter(Boolean).filter((line) => {
    const normalized = line.slice(3).replaceAll("\\", "/");
    return !ignored.some((prefix) => normalized.startsWith(prefix));
  });
  const untracked = [];
  for (const line of statusLines.filter((item) => item.startsWith("?? "))) {
    const relative = line.slice(3);
    const full = path.resolve(root, relative);
    try {
      const stat = await fs.stat(full);
      if (stat.isFile() && stat.size <= 5_000_000) untracked.push([relative, hashValue(await fs.readFile(full))]);
    } catch {
      untracked.push([relative, "unreadable"]);
    }
  }
  return hashValue({
    head: head.exitCode === 0 ? head.stdout.trim() : "unborn",
    status: statusLines,
    diff: diff.stdout,
    staged: staged.stdout,
    untracked,
  });
}

function resolveProfile(config, name, extraEnv = {}) {
  if (!name) return null;
  const raw = config.profiles?.[name];
  if (!raw) throw new Error(`Unknown profile ${name}`);
  const baseEnv = { ...process.env, ...extraEnv, ...(raw.env || {}) };
  const initial = expandObject(raw, baseEnv);
  const env = {
    ...baseEnv,
    ...(initial.env || {}),
    AGENTIC_PROFILE: name,
    AGENTIC_APP_ORIGIN: initial.app_origin || "",
    AGENTIC_API_ORIGIN: initial.api_origin || "",
    AGENTIC_MOCK_POLICY: initial.mock_policy || "not-applicable",
    AGENTIC_EXPECTED_MARKER_HEADER: initial.marker?.header || "",
    AGENTIC_EXPECTED_MARKER_VALUE: initial.marker?.value || "",
  };
  return { profile: expandObject(raw, env), env };
}

async function harnessHash() {
  return hashValue(await fs.readFile(fileURLToPath(import.meta.url)));
}

async function trustedPublicKey(context) {
  const trust = context.config.authority?.trust || {};
  let material = trust.public_key;
  if (!material && trust.public_key_file) {
    const expanded = expandString(String(trust.public_key_file), process.env);
    material = await fs.readFile(path.resolve(context.root, expanded), "utf8");
  }
  if (!material) throw new Error("Verifier authority has no trusted public key.");
  if (typeof material === "string" && material.includes("\\n") && !material.includes("\n")) material = material.replaceAll("\\n", "\n");
  try {
    const key = createPublicKey(material);
    if (key.asymmetricKeyType !== "ed25519") throw new Error(`expected ed25519, got ${key.asymmetricKeyType || "unknown"}`);
    return key;
  } catch (error) {
    throw new Error(`Cannot load trusted Ed25519 public key: ${error.message}`);
  }
}

async function trustedPublicKeyFingerprint(context) {
  const key = await trustedPublicKey(context);
  return hashValue(key.export({ type: "spki", format: "der" }));
}

async function effectiveConfigHash(context) {
  if (context.config.authority?.mode !== "verifier") return hashValue(context.config);
  const normalized = structuredClone(context.config);
  normalized.authority.trust = { ...(normalized.authority.trust || {}) };
  delete normalized.authority.trust.public_key;
  delete normalized.authority.trust.public_key_file;
  normalized.authority.trust.public_key_sha256 = await trustedPublicKeyFingerprint(context);
  return hashValue(normalized);
}

function profileDefinitionHashes(context) {
  const hashes = {};
  const names = [...new Set(context.task.checks.map((check) => check.profile).filter(Boolean))].sort();
  for (const name of names) {
    const resolved = resolveProfile(context.config, name, { AGENTIC_RUN_NONCE: "<agentic-run-nonce>" });
    hashes[name] = hashValue(resolved.profile);
  }
  return hashes;
}

async function evidenceIdentity(context) {
  return {
    contract_hash: hashValue(context.task),
    workspace_fingerprint: await workspaceFingerprint(context.root, context.config.evidence_root || ".agentic/evidence"),
    config_hash: await effectiveConfigHash(context),
    harness_hash: await harnessHash(),
    profile_definition_hashes: profileDefinitionHashes(context),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  };
}

export async function buildVerifierBinding(context, options = {}) {
  if (context.config.authority?.mode !== "verifier") throw new Error("Verifier grant requests require authority.mode=verifier.");
  const candidateId = String(options.candidateId || process.env.AGENTIC_CANDIDATE_ID || "").trim();
  if (!candidateId) throw new Error("Verifier authority requires AGENTIC_CANDIDATE_ID.");
  const identity = await evidenceIdentity(context);
  const trust = context.config.authority.trust || {};
  return {
    schema_version: 1,
    purpose: VERIFIER_PURPOSE,
    task_id: context.task.task_id,
    contract_version: context.task.contract_version,
    verifier_id: context.config.authority.verifier_id,
    issuer: trust.issuer,
    repository: trust.repository || null,
    workflow_ref: trust.workflow_ref || null,
    candidate_id: candidateId,
    required_checks: context.task.checks.filter((check) => check.required !== false).map((check) => check.id).sort(),
    trusted_public_key_sha256: await trustedPublicKeyFingerprint(context),
    ...identity,
  };
}

export async function verifyVerifierGrant(context, grant, options = {}) {
  if (!grant || grant.schema_version !== 1 || grant.algorithm !== VERIFIER_ALGORITHM || !grant.payload || !grant.signature) {
    throw new Error("Invalid verifier grant envelope.");
  }
  const key = await trustedPublicKey(context);
  let signature;
  try { signature = Buffer.from(String(grant.signature), "base64"); }
  catch { throw new Error("Verifier grant signature is not valid base64."); }
  if (!verifySignature(null, Buffer.from(stableStringify(grant.payload)), key, signature)) {
    throw new Error("Verifier grant signature does not match the trusted public key.");
  }
  const issuedAt = Date.parse(grant.payload.issued_at);
  const expiresAt = Date.parse(grant.payload.expires_at);
  const now = Number(options.now || Date.now());
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error("Verifier grant has an invalid validity window.");
  if (issuedAt > now + 300_000) throw new Error("Verifier grant was issued too far in the future.");
  if (expiresAt <= now) throw new Error("Verifier grant has expired.");
  const maximum = Number(context.config.authority?.trust?.max_grant_ttl_seconds || 900) * 1000;
  if (expiresAt - issuedAt > maximum) throw new Error("Verifier grant exceeds the configured maximum lifetime.");
  const suppliedCandidate = options.candidateId || process.env.AGENTIC_CANDIDATE_ID || grant.payload.binding?.candidate_id;
  const expected = await buildVerifierBinding(context, { candidateId: suppliedCandidate });
  if (stableStringify(grant.payload.binding) !== stableStringify(expected)) {
    throw new Error("Verifier grant binding does not match the current contract, candidate, workspace, config, harness, profiles, or trust context.");
  }
  return {
    status: "authorized",
    grant_sha256: hashValue(grant),
    verifier_id: expected.verifier_id,
    issuer: expected.issuer,
    candidate_id: expected.candidate_id,
    trusted_public_key_sha256: expected.trusted_public_key_sha256,
    issued_at: grant.payload.issued_at,
    expires_at: grant.payload.expires_at,
  };
}

async function authorizeVerifierRun(context, args) {
  if (context.config.authority?.mode !== "verifier") return null;
  const reference = args["verifier-grant"] || process.env.AGENTIC_VERIFIER_GRANT;
  if (!reference || reference === true) throw new Error("Verifier mode requires a signed verifier grant via --verifier-grant or AGENTIC_VERIFIER_GRANT.");
  const file = path.resolve(context.root, String(reference));
  const grant = await readJson(file);
  const authorization = await verifyVerifierGrant(context, grant);
  return { file, grant, authorization };
}

async function runProbe(probe, env) {
  const expanded = expandObject(probe, env);
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(expanded.url, {
      method: expanded.method || "GET",
      headers: expanded.headers || {},
      signal: AbortSignal.timeout(Number(expanded.timeout_ms || 10_000)),
    });
    const body = await response.text();
    const errors = [];
    if (response.status !== Number(expanded.status ?? 200)) errors.push(`expected status ${expanded.status ?? 200}, got ${response.status}`);
    for (const [header, expected] of Object.entries(expanded.expect_headers || {})) {
      if (response.headers.get(header) !== String(expected)) errors.push(`expected ${header}=${expected}, got ${response.headers.get(header)}`);
    }
    if (expanded.expect_json) {
      try {
        const json = JSON.parse(body);
        for (const [key, expected] of Object.entries(expanded.expect_json)) {
          if (stableStringify(json[key]) !== stableStringify(expected)) errors.push(`expected JSON ${key}=${stableStringify(expected)}`);
        }
      } catch (error) {
        errors.push(`invalid JSON response: ${error.message}`);
      }
    }
    return { name: expanded.name || expanded.url, url: expanded.url, started_at: startedAt, status: errors.length ? "fail" : "pass", http_status: response.status, errors };
  } catch (error) {
    return { name: expanded.name || expanded.url, url: expanded.url, started_at: startedAt, status: "fail", errors: [error.message] };
  }
}

async function walkFiles(root) {
  if (!(await exists(root))) return [];
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(full));
    else files.push(full);
  }
  return files;
}

function matchesIgnored(value, patterns = []) {
  return patterns.some((pattern) => {
    try { return new RegExp(pattern, "i").test(value); } catch { return value.includes(pattern); }
  });
}

function validateSystemAttestation(attestation, check, env) {
  const errors = [];
  const requirement = check.artifacts?.system_attestation;
  if (!attestation || typeof attestation !== "object") return ["required system attestation is missing"];
  if (attestation.schema_version !== 1) errors.push("system attestation schema_version must be 1");
  if (attestation.kind !== requirement.kind) errors.push(`system attestation kind must be ${requirement.kind}`);
  if (attestation.task_id !== env.AGENTIC_TASK_ID) errors.push("system attestation task ID did not match");
  if (attestation.check_id !== env.AGENTIC_CHECK_ID) errors.push("system attestation check ID did not match");
  const nonceHash = hashValue(env.AGENTIC_RUN_NONCE);
  if (attestation.run_nonce_sha256 !== nonceHash) errors.push("system attestation run nonce did not match");
  if (attestation.correlation_id_sha256 !== nonceHash) errors.push("system attestation correlation ID did not match the run nonce");
  if (!attestation.subject?.type || !attestation.subject?.identity) errors.push("system attestation requires a typed subject identity");
  if (!SHA256_PATTERN.test(String(attestation.operation?.input_sha256 || ""))) errors.push("system attestation requires operation.input_sha256");
  if (!SHA256_PATTERN.test(String(attestation.operation?.output_sha256 || ""))) errors.push("system attestation requires operation.output_sha256");
  if (!Array.isArray(attestation.assertions) || attestation.assertions.length === 0) errors.push("system attestation requires assertions");
  const assertions = new Map();
  for (const assertion of attestation.assertions || []) {
    if (!assertion.id || assertions.has(assertion.id)) errors.push(`system attestation has missing or duplicate assertion ID ${assertion.id || "<missing>"}`);
    else assertions.set(assertion.id, assertion);
    if (assertion.status !== "pass") errors.push(`system assertion ${assertion.id || "<missing>"} did not pass`);
    if (!SHA256_PATTERN.test(String(assertion.evidence_sha256 || ""))) errors.push(`system assertion ${assertion.id || "<missing>"} requires evidence_sha256`);
  }
  for (const id of requirement.required_assertions || []) {
    if (!assertions.has(id)) errors.push(`required system assertion was not collected: ${id}`);
  }
  return errors;
}

async function collectArtifacts(checkDir, check, profile, config, env) {
  const attestationDir = path.join(checkDir, "attestations");
  const attestationFiles = (await walkFiles(attestationDir)).filter((file) => file.endsWith(".json"));
  const attestations = [];
  const errors = [];
  for (const file of attestationFiles) {
    try { attestations.push({ file, data: await readJson(file) }); }
    catch (error) { errors.push(error.message); }
  }
  if (check.artifacts?.attestation && attestations.length === 0) errors.push("required runtime attestation is missing");

  const allFiles = await walkFiles(checkDir);
  const screenshots = [...new Set([
    ...allFiles.filter((file) => /\.(png|jpe?g|webp)$/i.test(file)),
    ...attestations.flatMap(({ data }) => data.screenshots || []).map((file) => path.resolve(file)),
  ])].filter((file) => path.isAbsolute(file));
  const existingScreenshots = [];
  for (const file of screenshots) if (await exists(file)) existingScreenshots.push(file);
  const screenshotHashes = {};
  for (const file of existingScreenshots) screenshotHashes[file] = hashValue(await fs.readFile(file));
  const minimum = Number(check.artifacts?.screenshots_min || 0);
  if (existingScreenshots.length < minimum) errors.push(`required ${minimum} screenshots, found ${existingScreenshots.length}`);

  const testManifestFile = path.join(checkDir, "test-manifest.json");
  let testManifest = null;
  if (await exists(testManifestFile)) {
    try { testManifest = await readJson(testManifestFile); }
    catch (error) { errors.push(error.message); }
  }
  if (check.artifacts?.test_integrity) {
    if (!testManifest) errors.push("required test-integrity manifest is missing");
    else {
      if (!Array.isArray(testManifest.collected) || testManifest.collected.length === 0) errors.push("test-integrity manifest reports zero collected tests");
      const titles = new Set((testManifest.collected || []).map((item) => item.title));
      for (const expected of check.expected_tests || []) if (!titles.has(expected)) errors.push(`required test was not collected: ${expected}`);
      const skipped = (testManifest.results || []).filter((item) => item.status === "skipped" || item.expected_status === "skipped");
      if (skipped.length) errors.push(`${skipped.length} collected test result(s) were skipped`);
      const retried = (testManifest.results || []).filter((item) => Number(item.retry || 0) > 0);
      if (retried.length) errors.push(`${retried.length} test result(s) required a retry`);
    }
  }

  const systemAttestationFile = env.AGENTIC_SYSTEM_ATTESTATION;
  let systemAttestation = null;
  if (await exists(systemAttestationFile)) {
    try { systemAttestation = await readJson(systemAttestationFile); }
    catch (error) { errors.push(error.message); }
  }
  if (check.artifacts?.system_attestation) errors.push(...validateSystemAttestation(systemAttestation, check, env));

  const consoleErrors = attestations.flatMap(({ data }) => data.console_errors || []).filter((item) => !matchesIgnored(typeof item === "string" ? item : item.text || JSON.stringify(item), config.quality?.ignore_console_patterns));
  const pageErrors = attestations.flatMap(({ data }) => data.page_errors || []);
  const failedRequests = attestations.flatMap(({ data }) => data.failed_requests || []).filter((item) => !matchesIgnored(typeof item === "string" ? item : item.url || JSON.stringify(item), config.quality?.ignore_request_patterns));
  if (config.quality?.fail_on_console_errors !== false && consoleErrors.length) errors.push(`${consoleErrors.length} relevant browser console error(s)`);
  if (config.quality?.fail_on_page_errors !== false && pageErrors.length) errors.push(`${pageErrors.length} page error(s)`);
  if (config.quality?.fail_on_failed_requests !== false && failedRequests.length) errors.push(`${failedRequests.length} failed request(s)`);

  if (profile?.mock_policy === "forbid-first-party" && check.artifacts?.attestation) {
    if (attestations.some(({ data }) => data.first_party_mocked === true)) errors.push("attestation reports a first-party mock in a real-service profile");
    const responses = attestations.flatMap(({ data }) => data.api_responses || []);
    const expectedOrigin = profile.api_origin ? new URL(profile.api_origin).origin : null;
    const matching = responses.filter((response) => {
      try { return new URL(response.url).origin === expectedOrigin; } catch { return false; }
    });
    if (matching.length === 0) errors.push(`browser did not observe a response from expected API origin ${expectedOrigin}`);
    if (profile.marker?.header && profile.marker?.value) {
      const header = profile.marker.header.toLowerCase();
      const marked = matching.some((response) => String(response.headers?.[header] ?? response.headers?.[profile.marker.header] ?? "") === String(profile.marker.value));
      if (!marked) errors.push(`browser did not observe ${profile.marker.header}=${profile.marker.value} from the expected API`);
    }
  }
  let businessFlowProvenance = null;
  if (check.artifacts?.business_flow_provenance) {
    const expectedOrigin = profile?.api_origin ? new URL(profile.api_origin).origin : null;
    const expectedPath = check.business_request?.path;
    const expectedMethod = String(check.business_request?.method || "GET").toUpperCase();
    const responses = attestations.flatMap(({ data }) => data.api_responses || []).filter((response) => {
      try {
        const url = new URL(response.url);
        return url.origin === expectedOrigin && url.pathname === expectedPath && String(response.method || "GET").toUpperCase() === expectedMethod;
      } catch { return false; }
    });
    if (!expectedPath) errors.push("business-flow provenance requires business_request.path");
    if (!profile?.provenance?.correlation_url) errors.push("business-flow provenance requires profile.provenance.correlation_url");
    if (!profile?.provenance?.deployment_id) errors.push("business-flow provenance requires profile.provenance.deployment_id");
    if (responses.length !== 1) errors.push(`expected exactly one attested ${expectedMethod} ${expectedPath} business response, found ${responses.length}`);
    const browserRecord = responses[0] || null;
    if (browserRecord) {
      if (browserRecord.request_headers?.["x-agentic-run-id"] !== env.AGENTIC_RUN_NONCE) errors.push("business request did not carry the verifier run nonce");
      if (browserRecord.headers?.["x-agentic-run-id"] !== env.AGENTIC_RUN_NONCE) errors.push("business response did not echo the verifier run nonce");
      if (browserRecord.headers?.["x-agentic-deployment-id"] !== profile.provenance.deployment_id) errors.push("business response deployment identity did not match the protected profile");
      if (!browserRecord.headers?.["x-agentic-request-id"]) errors.push("business response did not provide a request ID");
      if (!browserRecord.headers?.["x-agentic-response-sha256"]) errors.push("business response did not provide a response hash");
    }
    let backendRecord = null;
    if (profile?.provenance?.correlation_url) {
      try {
        const response = await fetch(expandString(profile.provenance.correlation_url, env), { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) errors.push(`backend correlation lookup returned ${response.status}`);
        else backendRecord = await response.json();
      } catch (error) { errors.push(`backend correlation lookup failed: ${error.message}`); }
    }
    if (browserRecord && backendRecord) {
      if (backendRecord.run_id !== env.AGENTIC_RUN_NONCE) errors.push("backend correlation run ID did not match");
      if (backendRecord.request_id !== browserRecord.headers?.["x-agentic-request-id"]) errors.push("backend and browser request IDs did not match");
      if (backendRecord.response_sha256 !== browserRecord.headers?.["x-agentic-response-sha256"]) errors.push("backend and browser response hashes did not match");
      if (backendRecord.deployment_id !== profile.provenance.deployment_id) errors.push("backend deployment identity did not match the protected profile");
    }
    businessFlowProvenance = {
      run_nonce_sha256: hashValue(env.AGENTIC_RUN_NONCE),
      expected_origin: expectedOrigin,
      expected_path: expectedPath || null,
      expected_method: expectedMethod,
      browser_record: browserRecord,
      backend_record: backendRecord
    };
    await writeJson(path.join(checkDir, "business-flow-provenance.json"), businessFlowProvenance);
  }
  return {
    errors,
    attestation_files: attestationFiles,
    screenshots: existingScreenshots,
    screenshot_hashes: screenshotHashes,
    test_manifest: testManifest ? testManifestFile : null,
    test_integrity: testManifest,
    system_attestation: systemAttestation ? systemAttestationFile : null,
    system_attestation_data: systemAttestation,
    console_errors: consoleErrors,
    page_errors: pageErrors,
    failed_requests: failedRequests,
    business_flow_provenance: businessFlowProvenance,
  };
}

async function executeCheck(context, check, runDir, approval) {
  const checkDir = path.join(runDir, slug(check.id));
  const attestationDir = path.join(checkDir, "attestations");
  const artifactDir = path.join(checkDir, "artifacts");
  await fs.mkdir(attestationDir, { recursive: true });
  await fs.mkdir(artifactDir, { recursive: true });
  const runNonce = randomBytes(16).toString("hex");
  const resolved = resolveProfile(context.config, check.profile, { AGENTIC_RUN_NONCE: runNonce });
  const profile = resolved?.profile || null;
  const env = {
    ...(resolved?.env || process.env),
    AGENTIC_TASK_ID: context.task.task_id,
    AGENTIC_CHECK_ID: check.id,
    AGENTIC_ATTESTATION_DIR: attestationDir,
    AGENTIC_ARTIFACT_DIR: artifactDir,
    AGENTIC_TEST_MANIFEST: path.join(checkDir, "test-manifest.json"),
    AGENTIC_SYSTEM_ATTESTATION: path.join(checkDir, "system-attestation.json"),
    AGENTIC_RUN_NONCE: runNonce,
  };
  if (profile?.requires_approval && !approval) throw new Error(`Profile ${check.profile} requires --approve-external after user approval.`);
  if (profile?.external && check.stage === "post-deploy" && check.safe_for_live !== true && profile.kind === "production") {
    throw new Error(`Production check ${check.id} is not marked safe_for_live.`);
  }
  const missingEnv = (profile?.required_env || []).filter((name) => !process.env[name]);
  if (missingEnv.length) throw new Error(`Profile ${check.profile} requires environment variable(s): ${missingEnv.join(", ")}`);

  const probes = [];
  for (const probe of profile?.probes || []) probes.push(await runProbe(probe, env));
  const probeErrors = probes.filter((probe) => probe.status !== "pass");
  const startedAt = new Date();
  let commandResult = { exitCode: -1, stdout: "", stderr: "Command skipped because a readiness probe failed." };
  let timedOut = false;
  if (!probeErrors.length) {
    const timeoutMs = Number(check.timeout_ms || context.config.defaults?.check_timeout_ms || 900_000);
    commandResult = await new Promise((resolve) => {
      const child = spawn(expandString(check.command, env), { cwd: context.root, env, shell: true, windowsHide: true });
      let stdout = "";
      let stderr = "";
      const maximum = Number(context.config.defaults?.max_log_bytes || 5_000_000);
      child.stdout?.on("data", (chunk) => { if (stdout.length < maximum) stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk) => { if (stderr.length < maximum) stderr += chunk.toString(); });
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); resolve({ exitCode: -1, stdout, stderr: `${stderr}${error.message}` }); });
      child.on("close", (exitCode) => { clearTimeout(timer); resolve({ exitCode: exitCode ?? -1, stdout, stderr }); });
    });
  }
  await fs.writeFile(path.join(checkDir, "stdout.log"), commandResult.stdout, "utf8");
  await fs.writeFile(path.join(checkDir, "stderr.log"), commandResult.stderr, "utf8");
  await writeJson(path.join(checkDir, "environment.json"), {
    profile: check.profile || null,
    kind: profile?.kind || null,
    app_origin: profile?.app_origin || null,
    api_origin: profile?.api_origin || null,
    mock_policy: profile?.mock_policy || null,
    data_mode: profile?.data_mode || null,
    auth_mode: profile?.auth_mode || null,
    marker: profile?.marker || null,
    probes,
  });
  const artifacts = await collectArtifacts(checkDir, check, profile, context.config, env);
  const errors = [
    ...probeErrors.flatMap((probe) => probe.errors.map((error) => `${probe.name}: ${error}`)),
    ...(commandResult.exitCode === 0 ? [] : [`command exited ${commandResult.exitCode}`]),
    ...(timedOut ? ["command timed out"] : []),
    ...artifacts.errors,
  ];
  return {
    check_id: check.id,
    criterion_ids: check.criterion_ids,
    required: check.required !== false,
    stage: check.stage,
    profile: check.profile || null,
    profile_hash: profile ? hashValue(profile) : null,
    profile_definition_hash: check.profile ? profileDefinitionHashes(context)[check.profile] : null,
    run_nonce_hash: hashValue(env.AGENTIC_RUN_NONCE),
    command: check.command,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    exit_code: commandResult.exitCode,
    status: errors.length ? "fail" : "pass",
    errors,
    artifacts: {
      directory: checkDir,
      stdout: path.join(checkDir, "stdout.log"),
      stderr: path.join(checkDir, "stderr.log"),
      attestations: artifacts.attestation_files,
      screenshots: artifacts.screenshots,
      screenshot_hashes: artifacts.screenshot_hashes,
      test_manifest: artifacts.test_manifest,
      test_integrity: artifacts.test_integrity,
      system_attestation: artifacts.system_attestation,
      system_attestation_data: artifacts.system_attestation_data,
      business_flow_provenance: artifacts.business_flow_provenance,
    },
    visual_review: check.artifacts?.visual_review ? { status: "pending" } : null,
  };
}

function evidenceBase(context) {
  return path.resolve(context.root, context.config.evidence_root || ".agentic/evidence", slug(context.task.task_id));
}

async function loadIndex(context) {
  const file = path.join(evidenceBase(context), "index.json");
  return (await exists(file)) ? await readJson(file) : { schema_version: 1, task_id: context.task.task_id, runs: [] };
}

async function saveRun(context, runRecord, runFile) {
  await writeJson(runFile, runRecord);
  const index = await loadIndex(context);
  const relative = path.relative(context.root, runFile).replaceAll("\\", "/");
  index.runs = [...new Set([...(index.runs || []), relative])];
  await writeJson(path.join(evidenceBase(context), "index.json"), index);
}

async function readRuns(context) {
  const index = await loadIndex(context);
  const runs = [];
  for (const relative of index.runs || []) {
    const file = path.resolve(context.root, relative);
    if (await exists(file)) runs.push({ file, data: await readJson(file) });
  }
  return runs;
}

async function verifierRunAuthorization(context, run) {
  if (run.data.authority !== "verifier" || !run.data.verifier_grant || !run.data.candidate_id) {
    return { valid: false, error: "run does not contain signed verifier authority" };
  }
  try {
    const authorization = await verifyVerifierGrant(context, run.data.verifier_grant, {
      candidateId: run.data.candidate_id,
      now: Date.parse(run.data.started_at),
    });
    if (run.data.verifier_authorization?.grant_sha256 !== authorization.grant_sha256) {
      return { valid: false, error: "run authorization fingerprint does not match its verifier grant" };
    }
    return { valid: true, authorization };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

async function buildStatus(context) {
  const identity = await evidenceIdentity(context);
  const runs = await readRuns(context);
  const checks = [];
  const authorizationCache = new Map();
  for (const check of context.task.checks) {
    const allResults = runs.flatMap((run) => run.data.results.map((result) => ({ run, result }))).filter(({ result }) => result.check_id === check.id);
    const current = allResults.filter(({ run, result }) => {
      if (run.data.contract_hash !== identity.contract_hash || run.data.workspace_fingerprint !== identity.workspace_fingerprint) return false;
      if (run.data.config_hash !== identity.config_hash || run.data.harness_hash !== identity.harness_hash) return false;
      if (stableStringify(run.data.profile_definition_hashes || {}) !== stableStringify(identity.profile_definition_hashes)) return false;
      if (stableStringify(run.data.toolchain || {}) !== stableStringify(identity.toolchain)) return false;
      if (process.env.AGENTIC_CANDIDATE_ID && run.data.candidate_id !== process.env.AGENTIC_CANDIDATE_ID) return false;
      const expectedProfileHash = check.profile ? identity.profile_definition_hashes[check.profile] : null;
      return (result.profile_definition_hash || null) === expectedProfileHash;
    });
    const latest = current.at(-1);
    let state = "missing";
    let verifierAuthorized = false;
    let authorizationError = null;
    if (!latest && allResults.length) state = "stale";
    if (latest) {
      state = latest.result.status;
      if (context.config.authority?.mode === "verifier") {
        const cacheKey = latest.run.file;
        if (!authorizationCache.has(cacheKey)) authorizationCache.set(cacheKey, await verifierRunAuthorization(context, latest.run));
        const verdict = authorizationCache.get(cacheKey);
        verifierAuthorized = verdict.valid;
        authorizationError = verdict.error || null;
        if (state === "pass" && !verifierAuthorized) state = "unauthorized";
      }
      if (state === "pass" && check.artifacts?.visual_review && latest.result.visual_review?.status !== "pass") state = latest.result.visual_review?.status === "fail" ? "fail" : "pending-visual-review";
      if (state === "pass" && check.artifacts?.visual_review && context.config.authority?.mode === "verifier" && latest.result.visual_review?.authority === "builder-agent") state = "pending-visual-review";
    }
    checks.push({
      id: check.id,
      required: check.required !== false,
      state,
      evidence_authority: latest?.run.data.authority || null,
      verifier_authorized: verifierAuthorized,
      authorization_error: authorizationError,
      result: latest?.result || null,
      run_file: latest?.run.file || null,
    });
  }
  const required = checks.filter((check) => check.required);
  const closureAuthorized = context.config.authority?.mode === "verifier" && required.length > 0 && required.every((check) => check.verifier_authorized);
  let overall = closureAuthorized ? "closure-verified" : "locally-verified";
  if (required.some((check) => check.state === "fail")) overall = "failed";
  else if (required.some((check) => ["missing", "pending-visual-review", "unauthorized"].includes(check.state))) overall = "incomplete";
  else if (required.some((check) => check.state === "stale")) overall = "stale";
  const criteria = context.task.acceptance.map((criterion) => {
    const related = checks.filter((check) => check.required && context.task.checks.find((source) => source.id === check.id)?.criterion_ids.includes(criterion.id));
    return { id: criterion.id, behavior: criterion.behavior, status: related.every((check) => check.state === "pass") ? "pass" : "not-proven", checks: related.map((check) => ({ id: check.id, state: check.state })) };
  });
  return {
    schema_version: 2,
    task_id: context.task.task_id,
    contract_version: context.task.contract_version,
    authority: closureAuthorized ? "verifier" : "local",
    requested_authority: context.config.authority?.mode || "local",
    overall_status: overall,
    contract_hash: identity.contract_hash,
    workspace_fingerprint: identity.workspace_fingerprint,
    config_hash: identity.config_hash,
    harness_hash: identity.harness_hash,
    profile_definition_hashes: identity.profile_definition_hashes,
    toolchain: identity.toolchain,
    criteria,
    checks
  };
}

async function writeStatus(context, status) {
  const base = evidenceBase(context);
  await writeJson(path.join(base, "latest.json"), status);
  const lines = [
    `# Evidence: ${context.task.task_id}`,
    "",
    `Overall: **${status.overall_status}**`,
    `Authority: **${status.authority}**`,
    ...(status.requested_authority !== status.authority ? [`Requested authority: **${status.requested_authority}**`] : []),
    "",
    "## Acceptance",
    "",
    ...status.criteria.map((criterion) => `- ${criterion.status === "pass" ? "[x]" : "[ ]"} ${criterion.id}: ${criterion.behavior}`),
    "",
    "## Required checks",
    "",
    ...status.checks.filter((check) => check.required).map((check) => `- ${check.id}: ${check.state}`),
    "",
    `Contract: \`${status.contract_hash}\``,
    `Workspace: \`${status.workspace_fingerprint}\``,
    "",
  ];
  await fs.writeFile(path.join(base, "latest.md"), `${lines.join("\n")}\n`, "utf8");
}

async function commandValidateTask(args) {
  const context = await loadContext(args);
  if (context.errors.length) throw new Error(`Invalid task contract:\n- ${context.errors.join("\n- ")}`);
  console.log(`Valid task contract: ${context.task.task_id}`);
}

async function commandGoalSpec(args) {
  const context = await loadContext(args);
  if (context.errors.length) throw new Error(`Invalid task contract:\n- ${context.errors.join("\n- ")}`);
  const goal = buildGoalSpec(context.task);
  if (args.json === true) console.log(JSON.stringify(goal, null, 2));
  else console.log(goal.objective);
}

async function commandGrantRequest(args) {
  const context = await loadContext(args);
  if (context.errors.length) throw new Error(`Invalid task contract:\n- ${context.errors.join("\n- ")}`);
  const request = { schema_version: 1, binding: await buildVerifierBinding(context) };
  if (args.output && args.output !== true) {
    const file = path.resolve(context.root, String(args.output));
    await writeJson(file, request);
    console.log(`Wrote verifier grant request ${file}`);
  } else {
    console.log(JSON.stringify(request, null, 2));
  }
}

async function commandRun(args) {
  const context = await loadContext(args);
  if (context.errors.length) throw new Error(`Invalid task contract:\n- ${context.errors.join("\n- ")}`);
  const selected = context.task.checks.filter((check) => {
    if (args.check && check.id !== args.check) return false;
    if (args.stage && check.stage !== args.stage) return false;
    if (args.profile && check.profile !== args.profile) return false;
    return true;
  });
  if (!selected.length) throw new Error("No checks match the supplied filters.");
  for (const check of selected) {
    const profile = check.profile ? context.config.profiles[check.profile] : null;
    if (profile?.requires_approval && args["approve-external"] !== true) throw new Error(`Profile ${check.profile} requires --approve-external after user approval.`);
  }
  const verifier = await authorizeVerifierRun(context, args);
  const identity = await evidenceIdentity(context);
  const base = evidenceBase(context);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const runDir = path.join(base, "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  const runRecord = {
    schema_version: 2,
    run_id: runId,
    task_id: context.task.task_id,
    contract_version: context.task.contract_version,
    contract_hash: identity.contract_hash,
    workspace_fingerprint: identity.workspace_fingerprint,
    config_hash: identity.config_hash,
    harness_hash: identity.harness_hash,
    profile_definition_hashes: identity.profile_definition_hashes,
    authority: verifier ? "verifier" : "local",
    verifier_id: verifier?.authorization.verifier_id || null,
    candidate_id: process.env.AGENTIC_CANDIDATE_ID || null,
    toolchain: identity.toolchain,
    verifier_authorization: verifier?.authorization || null,
    verifier_grant: verifier?.grant || null,
    started_at: new Date().toISOString(),
    results: [],
  };
  for (const check of selected) {
    console.log(`Running ${check.id} (${check.stage}${check.profile ? `, ${check.profile}` : ""})`);
    runRecord.results.push(await executeCheck(context, check, runDir, args["approve-external"] === true));
  }
  runRecord.finished_at = new Date().toISOString();
  const runFile = path.join(runDir, "run.json");
  await saveRun(context, runRecord, runFile);
  const status = await buildStatus(context);
  await writeStatus(context, status);
  for (const result of runRecord.results) console.log(`${result.status === "pass" ? "PASS" : "FAIL"} ${result.check_id}${result.errors.length ? `: ${result.errors.join("; ")}` : ""}`);
  console.log(`Overall: ${status.overall_status}`);
  if (runRecord.results.some((result) => result.status === "fail")) process.exitCode = 1;
}

async function commandStatus(args) {
  const context = await loadContext(args);
  if (context.errors.length) throw new Error(`Invalid task contract:\n- ${context.errors.join("\n- ")}`);
  const status = await buildStatus(context);
  await writeStatus(context, status);
  if (args.json) console.log(JSON.stringify(status, null, 2));
  else {
    console.log(`${status.task_id}: ${status.overall_status}`);
    for (const check of status.checks.filter((item) => item.required)) console.log(`- ${check.id}: ${check.state}`);
  }
  if (!status.overall_status.endsWith("-verified")) process.exitCode = 1;
}

async function commandVisualReview(args) {
  const context = await loadContext(args);
  if (context.errors.length) throw new Error(`Invalid task contract:\n- ${context.errors.join("\n- ")}`);
  if (!args.check) throw new Error("Pass --check <check-id>.");
  if (!["pass", "fail"].includes(args.status)) throw new Error("Pass --status pass|fail.");
  if (!args.notes || args.notes === true) throw new Error("Pass --notes <visual-review-notes>.");
  if (!args.reviewer || args.reviewer === true) throw new Error("Pass --reviewer <reviewer-id>.");
  if (!["builder-agent", "independent-agent", "human"].includes(args.authority)) throw new Error("Pass --authority builder-agent|independent-agent|human.");
  if (context.config.authority?.mode === "verifier" && args.authority === "builder-agent") throw new Error("Protected verifier mode does not accept builder-agent visual review.");
  if (!["high", "medium", "low"].includes(args.confidence)) throw new Error("Pass --confidence high|medium|low.");
  if (!args["observed-state"] || args["observed-state"] === true) throw new Error("Pass --observed-state <what-was-visible>.");
  if (!args.anomalies || args.anomalies === true) throw new Error("Pass --anomalies <none-or-observed-anomalies>.");
  const statusBefore = await buildStatus(context);
  const current = statusBefore.checks.find((check) => check.id === args.check);
  if (!current?.run_file || !current.result) throw new Error(`No current result exists for ${args.check}.`);
  if (current.result.status !== "pass") throw new Error(`Cannot approve visual evidence for a failed check ${args.check}.`);
  const run = await readJson(current.run_file);
  const result = run.results.find((item) => item.check_id === args.check);
  const available = result.artifacts?.screenshots || [];
  const requested = (args.image || []).map((image) => path.resolve(context.root, image));
  const reviewed = requested.length ? requested : available;
  if (!reviewed.length) throw new Error(`No screenshots are available for ${args.check}.`);
  for (const image of reviewed) {
    if (!(await exists(image))) throw new Error(`Reviewed image does not exist: ${image}`);
    if (!available.includes(image)) throw new Error(`Image is not part of the current check evidence: ${image}`);
    const currentHash = hashValue(await fs.readFile(image));
    const recordedHash = result.artifacts.screenshot_hashes?.[image];
    if (!recordedHash || recordedHash !== currentHash) throw new Error(`Image changed after evidence capture: ${image}`);
  }
  const review = {
    status: args.status,
    reviewed_at: new Date().toISOString(),
    reviewer: String(args.reviewer),
    authority: args.authority,
    confidence: args.confidence,
    observed_state: String(args["observed-state"]),
    anomalies: String(args.anomalies),
    images: reviewed.map((image) => ({ path: image, sha256: result.artifacts.screenshot_hashes[image] })),
    notes: String(args.notes)
  };
  result.visual_review = review;
  const checkDir = result.artifacts.directory;
  await writeJson(path.join(checkDir, "visual-review.json"), review);
  await writeJson(current.run_file, run);
  const finalStatus = await buildStatus(context);
  await writeStatus(context, finalStatus);
  console.log(`Recorded ${args.status} visual review for ${args.check}. Overall: ${finalStatus.overall_status}`);
  if (!finalStatus.overall_status.endsWith("-verified")) process.exitCode = 1;
}

async function commandDoctor(args) {
  const root = path.resolve(String(args.root || process.cwd()));
  const configPath = path.resolve(root, String(args.config || ".agentic/config.json"));
  const checks = [];
  checks.push({ name: "Node.js >= 20", status: Number(process.versions.node.split(".")[0]) >= 20 ? "pass" : "fail", detail: process.versions.node });
  if (await exists(configPath)) {
    try { validateConfig(await readJson(configPath)); checks.push({ name: "configuration", status: "pass", detail: configPath }); }
    catch (error) { checks.push({ name: "configuration", status: "fail", detail: error.message }); }
  } else checks.push({ name: "configuration", status: "fail", detail: `missing ${configPath}` });
  const bd = await capture("bd --version", { cwd: root, env: process.env });
  checks.push({ name: "Beads", status: bd.exitCode === 0 ? "pass" : "optional", detail: bd.exitCode === 0 ? bd.stdout.trim() : "bd is not available" });
  for (const check of checks) console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
}

function printHelp() {
  console.log(`Agentic Delivery harness

Commands:
  doctor [--config path]
  validate-task --task id-or-path
  goal-spec --task id-or-path [--json]
  grant-request --task id-or-path [--output path]
  run --task id-or-path [--check id] [--stage stage] [--profile name] [--approve-external] [--verifier-grant path]
  status --task id-or-path [--json]
  visual-review --task id-or-path --check id --status pass|fail [--image path] --reviewer id --authority builder-agent|independent-agent|human --confidence high|medium|low --observed-state text --anomalies text --notes text
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || command === "help" || args.help) return printHelp();
  if (command === "doctor") return commandDoctor(args);
  if (command === "validate-task") return commandValidateTask(args);
  if (command === "goal-spec") return commandGoalSpec(args);
  if (command === "grant-request") return commandGrantRequest(args);
  if (command === "run") return commandRun(args);
  if (command === "status") return commandStatus(args);
  if (command === "visual-review") return commandVisualReview(args);
  throw new Error(`Unknown command: ${command}`);
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function sameFile(left, right) {
  try {
    const [realLeft, realRight] = await Promise.all([fs.realpath(left), fs.realpath(right)]);
    return comparablePath(realLeft) === comparablePath(realRight);
  } catch {
    return comparablePath(left) === comparablePath(right);
  }
}

const isEntrypoint = process.argv[1] && await sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
