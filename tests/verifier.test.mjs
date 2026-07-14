import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harness = path.join(repositoryRoot, "plugins", "agentic-delivery", "scripts", "agentic-harness.mjs");
const signer = path.join(repositoryRoot, "plugins", "agentic-delivery", "scripts", "sign-verifier-grant.mjs");

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: options.cwd, env: { ...process.env, ...(options.env || {}) }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

test("a signed verifier grant is required and produces closure-bound evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic verifier "));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const controllerDir = path.join(root, ".agentic", "evidence", "controller");
  await fs.mkdir(controllerDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const config = {
    schema_version: 2,
    authority: {
      mode: "verifier",
      verifier_id: "test-protected-verifier",
      trust: { issuer: "test-controller", repository: "example/agentic", public_key: publicPem, max_grant_ttl_seconds: 900 }
    },
    evidence_root: ".agentic/evidence",
    defaults: { check_timeout_ms: 30_000, max_log_bytes: 100_000 },
    quality: {},
    profiles: {}
  };
  const task = {
    schema_version: 2,
    contract_version: 1,
    task_id: "VERIFY-GRANT",
    planning: { size: "S", size_source: "inferred", confidence: "high" },
    risk_flags: ["logic"],
    acceptance: [{ id: "AC-1", surface: "logic", behavior: "Node executes the frozen candidate check." }],
    checks: [{ id: "node-version", criterion_ids: ["AC-1"], claim_scope: "The candidate can execute Node.", stage: "fast", command: "node --version", required: true, artifacts: {} }]
  };
  const configFile = path.join(root, "config.json");
  const taskFile = path.join(root, "task.json");
  const requestFile = path.join(controllerDir, "request.json");
  const grantFile = path.join(controllerDir, "grant.json");
  await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.writeFile(taskFile, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  const env = { AGENTIC_CANDIDATE_ID: "candidate-123" };

  const ungranted = await runNode([harness, "run", "--root", root, "--config", configFile, "--task", taskFile], { cwd: root, env });
  assert.notEqual(ungranted.code, 0);
  assert.match(`${ungranted.stdout}\n${ungranted.stderr}`, /requires a signed verifier grant/);

  const request = await runNode([harness, "grant-request", "--root", root, "--config", configFile, "--task", taskFile, "--output", requestFile], { cwd: root, env });
  assert.equal(request.code, 0, request.stderr);
  const signed = await runNode([
    signer, "--request", requestFile, "--output", grantFile,
    "--expected-candidate", "candidate-123", "--expected-repository", "example/agentic",
    "--expected-verifier-id", "test-protected-verifier", "--expected-issuer", "test-controller"
  ], { cwd: root, env: { AGENTIC_VERIFIER_PRIVATE_KEY: privatePem } });
  assert.equal(signed.code, 0, signed.stderr);

  const verified = await runNode([harness, "run", "--root", root, "--config", configFile, "--task", taskFile, "--verifier-grant", grantFile], { cwd: root, env });
  assert.equal(verified.code, 0, verified.stderr);
  assert.match(verified.stdout, /Overall: closure-verified/);

  const status = await runNode([harness, "status", "--root", root, "--config", configFile, "--task", taskFile, "--json"], { cwd: root, env });
  assert.equal(status.code, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.overall_status, "closure-verified");
  assert.equal(parsed.authority, "verifier");
  assert.equal(parsed.checks[0].verifier_authorized, true);

  await fs.writeFile(taskFile, `${JSON.stringify({ ...task, title: "Changed contract after verification" }, null, 2)}\n`, "utf8");
  const stale = await runNode([harness, "status", "--root", root, "--config", configFile, "--task", taskFile, "--json"], { cwd: root, env });
  assert.notEqual(stale.code, 0);
  assert.equal(JSON.parse(stale.stdout).overall_status, "stale");
});
