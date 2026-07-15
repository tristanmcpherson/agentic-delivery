import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign as signPayload } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { captureStableScreenshot } from "../plugins/vision/assets/playwright/agentic-evidence.mjs";
import { buildDeliveryBinding, validateAdvisoryReviewInput, validateTask, verifyDeliveryAttestation } from "../plugins/vision/scripts/agentic-harness.mjs";

const config = { profiles: {} };
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const harness = path.join(repositoryRoot, "plugins", "vision", "scripts", "agentic-harness.mjs");

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: process.env, windowsHide: true });
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

function assuranceTask(size = "S") {
  return {
    schema_version: 2,
    contract_version: 1,
    task_id: "T-ASSURANCE",
    planning: { size, size_source: "inferred", confidence: "high" },
    risk_gate_version: 1,
    risk_flags: ["logic", "security", "runtime-config", "performance", "deployment"],
    acceptance: [
      { id: "AC-LOGIC", surface: "logic", behavior: "The transition remains deterministic." },
      { id: "AC-SECURITY", surface: "security", behavior: "The authority boundary rejects builder promotion." },
      { id: "AC-OPS", surface: "ops", behavior: "Runtime policy, limits, and delivery bindings are enforced." },
    ],
    checks: [
      { id: "logic", criterion_ids: ["AC-LOGIC"], claim_scope: "Deterministic transition.", stage: "fast", command: "node --test logic", required: true, risk_flags: ["logic"], artifacts: {} },
      { id: "security", criterion_ids: ["AC-SECURITY"], claim_scope: "Authority boundary.", stage: "integration", command: "node --test security", required: true, risk_flags: ["security"], artifacts: {} },
      { id: "operations", criterion_ids: ["AC-OPS"], claim_scope: "Operational policy and delivery binding.", stage: "integration", command: "node --test ops", required: true, risk_flags: ["runtime-config", "performance", "deployment"], artifacts: {} },
    ],
  };
}

test("screenshot evidence waits for two consecutive hash-identical frames", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-screenshot-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "stable.png");
  const frames = [Buffer.from("transient"), Buffer.from("stable"), Buffer.from("stable")];
  let calls = 0;
  const page = {
    async bringToFront() {},
    async evaluate() {},
    async screenshot() { return frames[Math.min(calls++, frames.length - 1)]; },
    async waitForTimeout() {},
  };
  await captureStableScreenshot(page, file);
  assert.equal(calls, 3);
  assert.equal(await fs.readFile(file, "utf8"), "stable");
});

test("screenshot evidence rejects a page that never reaches a stable frame", async () => {
  let calls = 0;
  const page = {
    async bringToFront() {},
    async evaluate() {},
    async screenshot() { return Buffer.from(`frame-${calls++}`); },
    async waitForTimeout() {},
  };
  await assert.rejects(
    captureStableScreenshot(page, path.join(os.tmpdir(), "agentic-never-stable.png")),
    /did not reach two consecutive hash-identical frames/,
  );
  assert.equal(calls, 8);
});

test("direct risk gates are complete and independent of planning size", () => {
  assert.deepEqual(validateTask(assuranceTask("S"), config), []);
  assert.deepEqual(validateTask(assuranceTask("L"), config), []);
});

test("direct risk gates reject missing, undeclared, fast-only, and surface-incompatible mappings", () => {
  const missing = assuranceTask();
  missing.checks[2].risk_flags = ["runtime-config", "performance"];
  let errors = validateTask(missing, config);
  assert.ok(errors.some((error) => error.includes("risk deployment has no required direct gate")));

  const undeclared = assuranceTask();
  undeclared.checks[0].risk_flags.push("tenant");
  errors = validateTask(undeclared, config);
  assert.ok(errors.some((error) => error.includes("maps undeclared risk tenant")));

  const fastOnly = assuranceTask();
  fastOnly.checks[1].stage = "fast";
  errors = validateTask(fastOnly, config);
  assert.ok(errors.some((error) => error.includes("risk security gate security must run at integration")));

  const incompatible = assuranceTask();
  incompatible.checks[1].criterion_ids = ["AC-LOGIC"];
  errors = validateTask(incompatible, config);
  assert.ok(errors.some((error) => error.includes("surface-compatible criterion")));
});

test("advisory review input rejects authority claims, missing adversarial cases, and excessive retries", () => {
  const task = assuranceTask();
  const check = task.checks[1];
  check.artifacts.advisory_reviews = {
    required_lanes: ["gap"],
    required_adversarial_cases: ["mock-only"],
    required_cleanup_receipts: ["fixture"],
    max_retries: 1,
  };
  const input = {
    schema_version: 1,
    lane: "gap",
    reviewer: "reviewer-1",
    authority: "independent-agent",
    status: "pass",
    criterion_ids: ["AC-SECURITY"],
    surface: "security",
    findings: [],
    artifact_paths: ["current/stdout.log"],
    retry_index: 2,
    adversarial_cases: [],
    cleanup_receipts: [],
  };
  const errors = validateAdvisoryReviewInput(input, check, task, { orchestration: { max_review_retries: 2 } });
  assert.ok(errors.some((error) => error.includes("cannot claim independent")));
  assert.ok(errors.some((error) => error.includes("retry_index")));
  assert.ok(errors.some((error) => error.includes("mock-only")));
  assert.ok(errors.some((error) => error.includes("fixture")));
});

test("advisory reviews are bound to the current run and exact artifact hashes", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-review-"));
  const workspace = path.join(temporaryRoot, "workspace");
  await fs.mkdir(path.join(workspace, ".agentic", "tasks"), { recursive: true });
  const task = {
    schema_version: 2,
    contract_version: 1,
    task_id: "T-REVIEW",
    planning: { size: "S", size_source: "inferred", confidence: "high" },
    risk_flags: [],
    acceptance: [{ id: "AC-1", surface: "logic", behavior: "The current result survives adversarial review." }],
    checks: [{
      id: "focused",
      criterion_ids: ["AC-1"],
      claim_scope: "Current result and review binding.",
      stage: "fast",
      command: "node -e \"console.log('review-target')\"",
      required: true,
      artifacts: {
        advisory_reviews: {
          required_lanes: ["gap"],
          required_adversarial_cases: ["mock-only"],
          required_cleanup_receipts: ["fixture"],
          max_retries: 1,
        },
      },
    }],
  };
  await fs.writeFile(path.join(workspace, ".agentic", "config.json"), `${JSON.stringify({ schema_version: 2, authority: { mode: "local" }, evidence_root: ".agentic/evidence", orchestration: { max_review_retries: 2 }, profiles: {} }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(workspace, ".agentic", "tasks", "T-REVIEW.json"), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  try {
    const run = await runNode([harness, "run", "--root", workspace, "--task", "T-REVIEW"], workspace);
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Overall: incomplete/);
    const index = JSON.parse(await fs.readFile(path.join(workspace, ".agentic", "evidence", "T-REVIEW", "index.json"), "utf8"));
    const runFile = path.resolve(workspace, index.runs[0]);
    const runRecord = JSON.parse(await fs.readFile(runFile, "utf8"));
    const stdoutFile = runRecord.results[0].artifacts.stdout;
    const reviewInput = path.join(workspace, ".agentic", "evidence", "T-REVIEW", "review-input.json");
    await fs.writeFile(reviewInput, `${JSON.stringify({
      schema_version: 1,
      lane: "gap",
      reviewer: "gap-reviewer-1",
      status: "pass",
      criterion_ids: ["AC-1"],
      surface: "logic",
      findings: [],
      artifact_paths: [stdoutFile],
      retry_index: 0,
      adversarial_cases: [{ id: "mock-only", status: "pass" }],
      cleanup_receipts: [{ id: "fixture", status: "not-created" }],
    }, null, 2)}\n`, "utf8");
    const reviewed = await runNode([harness, "advisory-review", "--root", workspace, "--task", "T-REVIEW", "--check", "focused", "--input", reviewInput], workspace);
    assert.equal(reviewed.code, 0, reviewed.stderr);
    assert.match(reviewed.stdout, /Overall: locally-verified/);

    const healthyStatus = await runNode([harness, "status", "--root", workspace, "--task", "T-REVIEW", "--json"], workspace);
    assert.equal(healthyStatus.code, 0, healthyStatus.stderr);
    assert.equal(JSON.parse(healthyStatus.stdout).checks[0].state, "pass");

    await fs.appendFile(stdoutFile, "tampered-after-review\n", "utf8");
    const tamperedStatus = await runNode([harness, "status", "--root", workspace, "--task", "T-REVIEW", "--json"], workspace);
    assert.equal(tamperedStatus.code, 1, tamperedStatus.stderr);
    const tampered = JSON.parse(tamperedStatus.stdout);
    assert.equal(tampered.checks[0].state, "fail");
    assert.ok(tampered.checks[0].advisory_review_errors.some((error) => error.includes("changed after review")));
  } finally {
    const temporaryBase = path.resolve(os.tmpdir());
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(`${temporaryBase}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("delivered-and-verified requires distinct signed controller authority and exact closure, candidate, deployment, approval, and post-deploy bindings", async () => {
  const verifierKeys = generateKeyPairSync("ed25519");
  const deliveryKeys = generateKeyPairSync("ed25519");
  const publicPem = (key) => key.export({ type: "spki", format: "pem" });
  const context = {
    root: repositoryRoot,
    config: {
      authority: { mode: "verifier", verifier_id: "verifier-1", trust: { issuer: "ci", public_key: publicPem(verifierKeys.publicKey) } },
      delivery: { controller_id: "delivery-1", trust: { issuer: "release-controller", public_key: publicPem(deliveryKeys.publicKey), max_attestation_ttl_seconds: 900 } },
    },
    task: {
      task_id: "T-DELIVERY",
      contract_version: 4,
      checks: [{ id: "post-deploy", stage: "post-deploy", required: true }],
    },
  };
  const status = {
    overall_status: "closure-verified",
    authority: "verifier",
    candidate_id: "commit-123",
    contract_hash: "a".repeat(64),
    checks: [{
      id: "post-deploy",
      state: "pass",
      verifier_authorized: true,
      candidate_id: "commit-123",
      result: {
        artifacts: {
          business_flow_provenance: {
            backend_record: { deployment_id: "deploy-456" },
            browser_record: { headers: { "x-agentic-deployment-id": "deploy-456" } },
          },
        },
      },
    }],
  };
  const options = {
    target: "production/us-east",
    deployment_id: "deploy-456",
    approval: { id: "APP-9", approved_by: "release-owner", approved_at: "2026-07-14T16:00:00.000Z" },
  };
  const binding = await buildDeliveryBinding(context, status, options);
  const issuedAt = new Date("2026-07-14T16:01:00.000Z");
  const payload = {
    binding,
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + 600_000).toISOString(),
    controller_nonce: "fixture-nonce",
  };
  const envelope = {
    schema_version: 1,
    algorithm: "Ed25519",
    payload,
    signature: signPayload(null, Buffer.from(stableStringify(payload)), deliveryKeys.privateKey).toString("base64"),
  };
  const verified = await verifyDeliveryAttestation(context, status, envelope, { now: issuedAt.getTime() + 1_000 });
  assert.equal(verified.status, "authorized");
  assert.equal(verified.authority, "protected-delivery-controller");
  assert.equal(verified.approval_id, "APP-9");

  await assert.rejects(() => buildDeliveryBinding(context, { ...status, overall_status: "locally-verified", authority: "local" }, options), /protected closure/);
  await assert.rejects(() => buildDeliveryBinding(context, status, { ...options, deployment_id: "wrong-deployment" }), /observed deployment/);
  const sharedAuthority = structuredClone(context);
  sharedAuthority.config.delivery.trust.public_key = publicPem(verifierKeys.publicKey);
  await assert.rejects(() => buildDeliveryBinding(sharedAuthority, status, options), /distinct trusted keys/);

  const tampered = structuredClone(envelope);
  tampered.payload.binding.target = "production/other";
  await assert.rejects(() => verifyDeliveryAttestation(context, status, tampered, { now: issuedAt.getTime() + 1_000 }), /signature does not match/);
});
