import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign as signPayload } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const harness = path.join(repositoryRoot, "plugins", "vision", "scripts", "agentic-harness.mjs");

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function taskWith(checks, options = {}) {
  return {
    schema_version: 2,
    contract_version: 1,
    task_id: options.taskId || "T-EVIDENCE-INTEGRITY",
    planning: { size: "S", size_source: "inferred", confidence: "high" },
    risk_flags: options.riskFlags || [],
    acceptance: options.acceptance || [{ id: "AC-1", surface: "logic", behavior: "The required evidence proves one exact candidate." }],
    checks,
  };
}

function passCheck(id, overrides = {}) {
  return {
    id,
    criterion_ids: ["AC-1"],
    claim_scope: `Evidence for ${id}.`,
    stage: "fast",
    command: "node --version",
    required: true,
    artifacts: {},
    ...overrides,
  };
}

async function createWorkspace(t, task, configOverrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-evidence-integrity-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".agentic", "tasks"), { recursive: true });
  const config = {
    schema_version: 2,
    authority: { mode: "local" },
    evidence_root: ".agentic/evidence",
    defaults: { check_timeout_ms: 30_000, max_log_bytes: 100_000 },
    quality: {},
    profiles: {},
    ...configOverrides,
  };
  await fs.writeFile(path.join(root, ".agentic", "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(root, ".agentic", "tasks", `${task.task_id}.json`), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(root, "fixture.mjs"), `
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2];
if (mode === "manifest") {
  fs.writeFileSync(process.env.AGENTIC_TEST_MANIFEST, JSON.stringify({
    collected: [{ title: "required-case" }],
    results: [{ title: "required-case", status: "passed", expected_status: "passed", retry: 0 }]
  }));
} else if (mode === "system") {
  const nonceHash = createHash("sha256").update(process.env.AGENTIC_RUN_NONCE).digest("hex");
  fs.writeFileSync(process.env.AGENTIC_SYSTEM_ATTESTATION, JSON.stringify({
    schema_version: 1,
    kind: "async",
    task_id: process.env.AGENTIC_TASK_ID,
    check_id: process.env.AGENTIC_CHECK_ID,
    run_nonce_sha256: nonceHash,
    correlation_id_sha256: nonceHash,
    subject: { type: "job", identity: "fixture-job" },
    operation: { input_sha256: "a".repeat(64), output_sha256: "b".repeat(64) },
    assertions: [{ id: "postcondition-observed", status: "pass", evidence_sha256: "c".repeat(64) }]
  }));
} else if (mode === "screenshot") {
  fs.writeFileSync(path.join(process.env.AGENTIC_ARTIFACT_DIR, "final.png"), "stable-frame");
} else {
  throw new Error("unknown fixture mode");
}
`, "utf8");
  return root;
}

async function status(root, taskId, env = {}) {
  const result = await runNode([harness, "status", "--root", root, "--task", taskId, "--json"], { cwd: root, env });
  return { ...result, payload: JSON.parse(result.stdout) };
}

async function indexedRuns(root, taskId) {
  const index = JSON.parse(await fs.readFile(path.join(root, ".agentic", "evidence", taskId, "index.json"), "utf8"));
  return Promise.all(index.runs.map(async (relative) => ({
    file: path.resolve(root, relative),
    data: JSON.parse(await fs.readFile(path.resolve(root, relative), "utf8")),
  })));
}

test("status records one non-null workspace candidate when local checks omit an external candidate ID", async (t) => {
  // Given
  const task = taskWith([passCheck("one"), passCheck("two")]);
  const root = await createWorkspace(t, task);

  // When
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root });
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(run.code, 0, run.stderr);
  assert.equal(rebuilt.code, 0, rebuilt.stderr);
  assert.equal(rebuilt.payload.overall_status, "locally-verified");
  assert.match(rebuilt.payload.candidate_id, /^workspace:[a-f0-9]{64}$/);
  assert.deepEqual(new Set(rebuilt.payload.checks.map((check) => check.candidate_id)), new Set([rebuilt.payload.candidate_id]));
});

test("status rejects locally passing required checks from mixed candidates", async (t) => {
  // Given
  const task = taskWith([passCheck("one"), passCheck("two")]);
  const root = await createWorkspace(t, task);
  const first = await runNode([harness, "run", "--root", root, "--task", task.task_id, "--check", "one"], { cwd: root, env: { AGENTIC_CANDIDATE_ID: "candidate-a" } });
  const second = await runNode([harness, "run", "--root", root, "--task", task.task_id, "--check", "two"], { cwd: root, env: { AGENTIC_CANDIDATE_ID: "candidate-b" } });

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.overall_status, "stale");
  assert.equal(rebuilt.payload.candidate_id, null);
  assert.match(rebuilt.payload.candidate_error, /one exact non-null candidate/);
  assert.ok(rebuilt.payload.criteria.every((criterion) => criterion.status === "not-proven"));
});

test("status treats candidate identities that differ only by whitespace as different exact values", async (t) => {
  // Given
  const task = taskWith([passCheck("one"), passCheck("two")]);
  const root = await createWorkspace(t, task);
  for (const checkId of ["one", "two"]) {
    const run = await runNode([harness, "run", "--root", root, "--task", task.task_id, "--check", checkId], { cwd: root, env: { AGENTIC_CANDIDATE_ID: "candidate-a" } });
    assert.equal(run.code, 0, run.stderr);
  }
  const runs = await indexedRuns(root, task.task_id);
  runs[1].data.candidate_id = "candidate-a ";
  await fs.writeFile(runs[1].file, `${JSON.stringify(runs[1].data, null, 2)}\n`, "utf8");

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.overall_status, "stale");
  assert.equal(rebuilt.payload.candidate_id, null);
});

test("status rejects a required check whose recorded candidate identity is removed", async (t) => {
  // Given
  const task = taskWith([passCheck("one")]);
  const root = await createWorkspace(t, task);
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root, env: { AGENTIC_CANDIDATE_ID: "candidate-a" } });
  assert.equal(run.code, 0, run.stderr);
  const [record] = await indexedRuns(root, task.task_id);
  record.data.candidate_id = null;
  await fs.writeFile(record.file, `${JSON.stringify(record.data, null, 2)}\n`, "utf8");

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.overall_status, "stale");
  assert.match(rebuilt.payload.candidate_error, /one exact non-null candidate/);
});

test("status rejects mixed candidates even when every run has protected verifier authority", async (t) => {
  // Given
  const keys = generateKeyPairSync("ed25519");
  const task = taskWith([passCheck("one"), passCheck("two")], { taskId: "T-PROTECTED-CANDIDATE" });
  const root = await createWorkspace(t, task, {
    authority: {
      mode: "verifier",
      verifier_id: "test-verifier",
      trust: {
        issuer: "test-controller",
        public_key: keys.publicKey.export({ type: "spki", format: "pem" }),
        max_grant_ttl_seconds: 900,
      },
    },
  });
  const controllerDir = path.join(root, ".agentic", "evidence", "controller");
  await fs.mkdir(controllerDir, { recursive: true });
  for (const [checkId, candidateId] of [["one", "candidate-a"], ["two", "candidate-b"]]) {
    const request = await runNode([harness, "grant-request", "--root", root, "--task", task.task_id], { cwd: root, env: { AGENTIC_CANDIDATE_ID: candidateId } });
    assert.equal(request.code, 0, request.stderr);
    const now = Date.now();
    const payload = {
      binding: JSON.parse(request.stdout).binding,
      issued_at: new Date(now - 1_000).toISOString(),
      expires_at: new Date(now + 600_000).toISOString(),
      controller_nonce: `nonce-${candidateId}`,
    };
    const grant = {
      schema_version: 1,
      algorithm: "Ed25519",
      payload,
      signature: signPayload(null, Buffer.from(stableStringify(payload)), keys.privateKey).toString("base64"),
    };
    const grantFile = path.join(controllerDir, `${candidateId}-grant.json`);
    await fs.writeFile(grantFile, `${JSON.stringify(grant, null, 2)}\n`, "utf8");
    const run = await runNode([harness, "run", "--root", root, "--task", task.task_id, "--check", checkId, "--verifier-grant", grantFile], { cwd: root, env: { AGENTIC_CANDIDATE_ID: candidateId } });
    assert.equal(run.code, 0, run.stderr);
  }

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.overall_status, "stale");
  assert.equal(rebuilt.payload.authority, "verifier");
  assert.equal(rebuilt.payload.candidate_id, null);
});

test("status rejects a missing test-integrity manifest after a passing run", async (t) => {
  // Given
  const task = taskWith([passCheck("tests", {
    command: "node fixture.mjs manifest",
    expected_tests: ["required-case"],
    artifacts: { test_integrity: true },
  })]);
  const root = await createWorkspace(t, task);
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root });
  assert.equal(run.code, 0, run.stderr);
  const [record] = await indexedRuns(root, task.task_id);
  await fs.rm(record.data.results[0].artifacts.test_manifest);

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.checks[0].state, "stale");
  assert.ok(rebuilt.payload.checks[0].evidence_integrity_errors.some((error) => error.includes("missing")));
});

test("status rejects a mutated system attestation after a passing run", async (t) => {
  // Given
  const task = taskWith([passCheck("system", {
    stage: "integration",
    command: "node fixture.mjs system",
    artifacts: { system_attestation: { kind: "async", required_assertions: ["postcondition-observed"] } },
  })], {
    riskFlags: ["async"],
    acceptance: [{ id: "AC-1", surface: "async", behavior: "The async postcondition is independently observed." }],
  });
  const root = await createWorkspace(t, task);
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root });
  assert.equal(run.code, 0, run.stderr);
  const [record] = await indexedRuns(root, task.task_id);
  await fs.appendFile(record.data.results[0].artifacts.system_attestation, "\n ", "utf8");

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.checks[0].state, "stale");
  assert.ok(rebuilt.payload.checks[0].evidence_integrity_errors.some((error) => error.includes("changed")));
});

test("status rejects a passing run that removes its required system-attestation binding", async (t) => {
  // Given
  const task = taskWith([passCheck("system", {
    stage: "integration",
    command: "node fixture.mjs system",
    artifacts: { system_attestation: { kind: "async", required_assertions: ["postcondition-observed"] } },
  })], {
    riskFlags: ["async"],
    acceptance: [{ id: "AC-1", surface: "async", behavior: "The async postcondition is independently observed." }],
  });
  const root = await createWorkspace(t, task);
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root });
  assert.equal(run.code, 0, run.stderr);
  const [record] = await indexedRuns(root, task.task_id);
  record.data.results[0].artifacts.system_attestation = null;
  record.data.results[0].artifacts.system_attestation_sha256 = null;
  await fs.writeFile(record.file, `${JSON.stringify(record.data, null, 2)}\n`, "utf8");

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.checks[0].state, "stale");
  assert.ok(rebuilt.payload.checks[0].evidence_integrity_errors.some((error) => error.includes("required system attestation")));
});

test("status rejects a screenshot changed after exact-image visual review", async (t) => {
  // Given
  const task = taskWith([passCheck("visual", {
    stage: "integration",
    command: "node fixture.mjs screenshot",
    artifacts: { screenshots_min: 1, visual_review: true },
  })]);
  const root = await createWorkspace(t, task);
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root });
  assert.equal(run.code, 0, run.stderr);
  const review = await runNode([
    harness, "visual-review", "--root", root, "--task", task.task_id, "--check", "visual",
    "--status", "pass", "--notes", "fixture reviewed", "--reviewer", "reviewer-1",
    "--authority", "builder-agent", "--confidence", "high", "--observed-state", "stable fixture",
    "--anomalies", "none",
  ], { cwd: root });
  assert.equal(review.code, 0, review.stderr);
  const [record] = await indexedRuns(root, task.task_id);
  await fs.writeFile(record.data.results[0].artifacts.screenshots[0], "changed-frame", "utf8");

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.checks[0].state, "stale");
  assert.ok(rebuilt.payload.checks[0].evidence_integrity_errors.some((error) => error.includes("changed")));
});

test("status rejects visual review bound to a different candidate contributor", async (t) => {
  // Given
  const task = taskWith([passCheck("visual", {
    stage: "integration",
    command: "node fixture.mjs screenshot",
    artifacts: { screenshots_min: 1, visual_review: true },
  })]);
  const root = await createWorkspace(t, task);
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root, env: { AGENTIC_CANDIDATE_ID: "candidate-a" } });
  assert.equal(run.code, 0, run.stderr);
  const review = await runNode([
    harness, "visual-review", "--root", root, "--task", task.task_id, "--check", "visual",
    "--status", "pass", "--notes", "fixture reviewed", "--reviewer", "reviewer-1",
    "--authority", "builder-agent", "--confidence", "high", "--observed-state", "stable fixture",
    "--anomalies", "none",
  ], { cwd: root, env: { AGENTIC_CANDIDATE_ID: "candidate-a" } });
  assert.equal(review.code, 0, review.stderr);
  const [record] = await indexedRuns(root, task.task_id);
  record.data.results[0].visual_review.binding.candidate_id = "candidate-b";
  await fs.writeFile(record.file, `${JSON.stringify(record.data, null, 2)}\n`, "utf8");

  // When
  const rebuilt = await status(root, task.task_id, { AGENTIC_CANDIDATE_ID: "candidate-a" });

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.checks[0].state, "fail");
  assert.ok(rebuilt.payload.checks[0].visual_review_errors.some((error) => error.includes("binding does not match")));
});

test("status rejects a structured advisory-review input changed after recording", async (t) => {
  // Given
  const task = taskWith([passCheck("reviewed", {
    artifacts: {
      advisory_reviews: {
        required_lanes: ["gap"],
        required_adversarial_cases: ["tamper"],
        required_cleanup_receipts: ["fixture"],
        max_retries: 0,
      },
    },
  })]);
  const root = await createWorkspace(t, task);
  const run = await runNode([harness, "run", "--root", root, "--task", task.task_id], { cwd: root });
  assert.equal(run.code, 0, run.stderr);
  const [record] = await indexedRuns(root, task.task_id);
  const inputFile = path.join(root, ".agentic", "evidence", task.task_id, "review-input.json");
  await fs.writeFile(inputFile, `${JSON.stringify({
    schema_version: 1,
    lane: "gap",
    reviewer: "reviewer-1",
    status: "pass",
    criterion_ids: ["AC-1"],
    surface: "logic",
    findings: [],
    artifact_paths: [record.data.results[0].artifacts.stdout],
    retry_index: 0,
    adversarial_cases: [{ id: "tamper", status: "pass" }],
    cleanup_receipts: [{ id: "fixture", status: "not-created" }],
  }, null, 2)}\n`, "utf8");
  const reviewed = await runNode([harness, "advisory-review", "--root", root, "--task", task.task_id, "--check", "reviewed", "--input", inputFile], { cwd: root });
  assert.equal(reviewed.code, 0, reviewed.stderr);
  await fs.appendFile(inputFile, " \n", "utf8");

  // When
  const rebuilt = await status(root, task.task_id);

  // Then
  assert.equal(rebuilt.code, 1, rebuilt.stderr);
  assert.equal(rebuilt.payload.checks[0].state, "fail");
  assert.ok(rebuilt.payload.checks[0].advisory_review_errors.some((error) => error.includes("input changed after review")));
});
