import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1")), "..");
const harness = path.join(root, "plugins", "vision", "scripts", "agentic-harness.mjs");
const lifecycle = path.join(root, "plugins", "vision", "scripts", "agentic-lifecycle.mjs");
const config = path.join(root, "proof", "config.json");
const outcomes = [];
const playwrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(root, ".playwright-browsers");

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath, ...(options.env || {}) }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr, duration_ms: Date.now() - started }));
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function start(script, args) {
  return spawn(process.execPath, [path.join(root, script), ...args], { cwd: root, env: process.env, windowsHide: true });
}

async function stop(service) {
  if (!service || service.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    service.once("close", () => { clearTimeout(timer); resolve(); });
    service.kill("SIGTERM");
  });
}

function expectResult(id, kind, label, result, shouldPass, pattern) {
  const passed = result.code === 0;
  const patternMatched = !pattern || pattern.test(`${result.stdout}\n${result.stderr}`);
  const matchedExpectation = passed === shouldPass && patternMatched;
  outcomes.push({
    id,
    kind,
    label,
    expected_process_success: shouldPass,
    observed_process_success: passed,
    expected_output_matched: patternMatched,
    matched_expectation: matchedExpectation,
    duration_ms: result.duration_ms,
  });
  if (!matchedExpectation) {
    throw new Error(`${label} produced an unexpected result (${result.code}).\n${result.stdout}\n${result.stderr}`);
  }
  console.log(`${shouldPass ? "PASS" : "EXPECTED FAIL"} ${label}`);
}

async function harnessRun(command, task, extra = []) {
  return runNode([harness, command, "--root", root, "--config", config, "--task", path.join(root, "proof", "tasks", task), ...extra]);
}

const services = [];
try {
  const discovery = await harnessRun("validate-task", "discovery-healthy.json");
  expectResult("discovery-contract-healthy", "healthy", "resolved read-only discovery contract is accepted", discovery, true, /Valid task contract: PROOF-DISCOVERY-HEALTHY/);

  const goalSpec = await harnessRun("goal-spec", "discovery-healthy.json", ["--json"]);
  expectResult("goal-spec-bound", "healthy", "canonical goal binds contract acceptance and completion target", goalSpec, true, /"acceptance_ids"[\s\S]*"AC-PARSER"[\s\S]*"intent_sha256": "[a-f0-9]{64}"/);

  const unresolvedDiscovery = await harnessRun("validate-task", "discovery-unresolved.json");
  expectResult("discovery-material-unresolved", "defect", "unresolved material discovery blocks contract readiness", unresolvedDiscovery, false, /material intake question RQ-MATERIAL must be resolved[\s\S]*unresolved_material must be empty/);

  const unsafeScout = await harnessRun("validate-task", "discovery-unsafe-scout.json");
  expectResult("discovery-scout-write", "defect", "write-capable scout claims and raw transcripts are rejected", unsafeScout, false, /scope must be read-only[\s\S]*must not embed transcript/);

  const goalDrift = await harnessRun("validate-task", "goal-contract-drift.json");
  expectResult("goal-contract-drift", "defect", "goal acceptance cannot drift from the frozen contract", goalDrift, false, /goal_spec.acceptance_ids must exactly match task acceptance ids/);

  const rawPromptGoal = await runNode([lifecycle, "activate", "--root", root, "--task", path.join(root, "proof", "tasks", "discovery-healthy.json")]);
  expectResult("goal-intent-required", "defect", "raw prompt activation cannot bypass canonical goal reconciliation", rawPromptGoal, false, /Pass --goal-intent/);

  const missingRiskGate = await harnessRun("validate-task", "risk-gate-missing.json");
  expectResult("risk-gate-missing", "defect", "a declared security risk cannot omit its direct gate", missingRiskGate, false, /risk security has no required direct gate/);

  const fastRiskBypass = await harnessRun("validate-task", "risk-gate-fast-bypass.json");
  expectResult("risk-gate-fast-bypass", "defect", "planning size cannot turn a security integration gate into a fast-only check", fastRiskBypass, false, /risk security gate too-fast must run at integration/);

  const continuationGuards = await runNode(["--test", "--test-name-pattern", "continuation halts", path.join(root, "test", "agentic-lifecycle.test.mjs")]);
  expectResult("continuation-guards", "healthy", "bounded continuation halts on repeated no-progress, authorization, reentrancy, and context pressure", continuationGuards, true, /pass 1/);

  const advisoryBinding = await runNode(["--test", "--test-name-pattern", "advisory reviews are bound", path.join(root, "test", "agentic-assurance.test.mjs")]);
  expectResult("advisory-hash-binding", "healthy", "advisory review is current-attempt and artifact-hash bound", advisoryBinding, true, /pass 1/);

  const deliveryBinding = await runNode(["--test", "--test-name-pattern", "delivered-and-verified requires", path.join(root, "test", "agentic-assurance.test.mjs")]);
  expectResult("protected-delivery-binding", "healthy", "protected delivery requires distinct signed controller and exact closure bindings", deliveryBinding, true, /pass 1/);

  const deliveryWithoutClosure = await harnessRun("delivery-request", "production-sim.json", ["--target", "production", "--deployment-id", "production-fixture-v1", "--approval-id", "APP-PROOF", "--approved-by", "proof-owner", "--approved-at", "2026-07-14T16:00:00.000Z"]);
  expectResult("delivery-without-closure", "defect", "local or incomplete evidence cannot request delivered-and-verified authority", deliveryWithoutClosure, false, /requires current protected closure evidence/);

  const invalid = await harnessRun("validate-task", "mock-only-invalid.json");
  expectResult("mock-only-contract", "defect", "mock-only task contract is rejected", invalid, false, /real-service UI check/);

  const unit = await harnessRun("run", "healthy.json", ["--check", "unit-profile-contract"]);
  expectResult("focused-unit", "healthy", "focused unit contract", unit, true, /PASS unit-profile-contract/);

  const mockUi = start("proof/fixture/ui-server.mjs", ["--port", "46200", "--api-origin", "http://127.0.0.1:46201"]);
  services.push(mockUi);
  await waitFor("http://127.0.0.1:46200/health");
  const mock = await harnessRun("run", "healthy.json", ["--check", "ui-mocked"]);
  expectResult("mocked-partial-control", "control", "mocked browser journey passes but remains partial", mock, true, /PASS ui-mocked/);
  await stop(mockUi);
  services.splice(services.indexOf(mockUi), 1);

  const brokenApi = start("proof/fixture/api-server.mjs", ["--port", "46201", "--mode", "broken", "--marker", "broken-local", "--allow-origin", "http://127.0.0.1:46200"]);
  const brokenUi = start("proof/fixture/ui-server.mjs", ["--port", "46200", "--api-origin", "http://127.0.0.1:46201"]);
  services.push(brokenApi, brokenUi);
  await waitFor("http://127.0.0.1:46201/health");
  await waitFor("http://127.0.0.1:46200/health");
  const broken = await harnessRun("run", "broken-real.json");
  expectResult("real-api-mismatch", "defect", "real API incompatibility is detected", broken, false, /FAIL ui-real-broken/);
  await stop(brokenUi);
  await stop(brokenApi);
  services.splice(services.indexOf(brokenUi), 1);
  services.splice(services.indexOf(brokenApi), 1);

  const devApi = start("proof/fixture/api-server.mjs", ["--port", "46202", "--mode", "healthy", "--marker", "development", "--allow-origin", "http://127.0.0.1:46203"]);
  const devUi = start("proof/fixture/ui-server.mjs", ["--port", "46203", "--api-origin", "http://127.0.0.1:46202"]);
  services.push(devApi, devUi);
  await waitFor("http://127.0.0.1:46202/health");
  await waitFor("http://127.0.0.1:46203/health");
  const mixed = await harnessRun("run", "healthy.json", ["--check", "ui-mixed-real"]);
  expectResult("mixed-real-healthy", "healthy", "mixed UI and development API pass with attestation", mixed, true, /PASS ui-mixed-real/);

  const businessMocked = await harnessRun("run", "business-call-mocked.json");
  expectResult("business-request-mocked", "defect", "a correct health probe cannot hide a mocked business request", businessMocked, false, /first-party mock|business response/);

  const missingTest = await harnessRun("run", "missing-required-test.json");
  expectResult("missing-required-test", "defect", "a green command cannot omit the required test", missingTest, false, /required test was not collected/);

  const retryOnly = await harnessRun("run", "retry-only.json");
  expectResult("retry-only", "defect", "retry-only success is not clean verification", retryOnly, false, /required a retry/);

  const spoofApi = start("proof/fixture/api-server.mjs", ["--port", "46206", "--mode", "healthy", "--marker", "development", "--deployment-id", "attacker-fixture-v1", "--allow-origin", "http://127.0.0.1:46207"]);
  const spoofUi = start("proof/fixture/ui-server.mjs", ["--port", "46207", "--api-origin", "http://127.0.0.1:46206"]);
  services.push(spoofApi, spoofUi);
  await waitFor("http://127.0.0.1:46206/health");
  await waitFor("http://127.0.0.1:46207/health");
  const markerSpoof = await harnessRun("run", "marker-spoof.json");
  expectResult("marker-spoof", "defect", "a copied environment marker cannot spoof deployment identity", markerSpoof, false, /deployment identity/);

  const nonUi = await harnessRun("run", "non-ui-healthy.json");
  expectResult("non-ui-healthy", "healthy", "real SQLite migration and asynchronous worker checks pass", nonUi, true, /PASS sqlite-migration[\s\S]*PASS async-projection/);
  const brokenMigration = await harnessRun("run", "migration-broken.json");
  expectResult("migration-backfill-missing", "defect", "a green migration command cannot hide a missing backfill", brokenMigration, false, /data-preserved/);
  const brokenAsync = await harnessRun("run", "async-broken.json");
  expectResult("async-postcondition-missing", "defect", "worker acknowledgement cannot hide wrong correlation and missing postcondition", brokenAsync, false, /correlation-matched.*postcondition-observed/);

  const { publicKey } = generateKeyPairSync("ed25519");
  const falseClosureDir = path.join(root, "proof", "evidence", "false-closure-controller");
  await fs.mkdir(falseClosureDir, { recursive: true });
  const falseClosureConfig = JSON.parse(await fs.readFile(config, "utf8"));
  falseClosureConfig.authority = {
    mode: "verifier",
    verifier_id: "proof-protected-verifier",
    trust: {
      issuer: "proof-controller",
      repository: "local/agentic-proof",
      public_key: publicKey.export({ type: "spki", format: "pem" }),
      max_grant_ttl_seconds: 900
    }
  };
  const falseClosureConfigFile = path.join(falseClosureDir, "config.json");
  await fs.writeFile(falseClosureConfigFile, `${JSON.stringify(falseClosureConfig, null, 2)}\n`, "utf8");
  const falseClosure = await runNode([harness, "run", "--root", root, "--config", falseClosureConfigFile, "--task", path.join(root, "proof", "tasks", "healthy.json"), "--check", "unit-profile-contract"], {
    env: { AGENTIC_CANDIDATE_ID: "locally-forged-candidate" }
  });
  expectResult("false-closure-config-flip", "defect", "a local verifier-mode config flip cannot issue closure", falseClosure, false, /requires a signed verifier grant/);

  const productionApi = start("proof/fixture/api-server.mjs", ["--port", "46204", "--mode", "healthy", "--marker", "production", "--allow-origin", "http://127.0.0.1:46205"]);
  const productionUi = start("proof/fixture/ui-server.mjs", ["--port", "46205", "--api-origin", "http://127.0.0.1:46204"]);
  services.push(productionApi, productionUi);
  await waitFor("http://127.0.0.1:46204/health");
  await waitFor("http://127.0.0.1:46205/health");
  const unapproved = await harnessRun("run", "production-sim.json");
  expectResult("production-unapproved", "defect", "production profile refuses implicit execution", unapproved, false, /requires --approve-external/);
  const approved = await harnessRun("run", "production-sim.json", ["--approve-external"]);
  expectResult("production-approved", "healthy", "approved safe production simulation passes", approved, true, /PASS production-smoke/);

  const healthyStatus = JSON.parse(await fs.readFile(path.join(root, "proof", "evidence", "PROOF-HEALTHY", "latest.json"), "utf8"));
  const productionStatus = JSON.parse(await fs.readFile(path.join(root, "proof", "evidence", "PROOF-PRODUCTION", "latest.json"), "utf8"));
  const nonUiStatus = JSON.parse(await fs.readFile(path.join(root, "proof", "evidence", "PROOF-NON-UI", "latest.json"), "utf8"));
  const report = {
    generated_at: new Date().toISOString(),
    mechanical_proof: "pass",
    healthy_status: healthyStatus.overall_status,
    production_status: productionStatus.overall_status,
    non_ui_status: nonUiStatus.overall_status,
    screenshots: [
      ...healthyStatus.checks.flatMap((check) => check.result?.artifacts?.screenshots || []),
      ...productionStatus.checks.flatMap((check) => check.result?.artifacts?.screenshots || [])
    ],
    note: "Mechanical controls passed. Material visual checks remain locally incomplete until a reviewer opens the exact image hashes and records structured review evidence. Protected verifier mode does not accept builder-agent review."
  };
  await fs.writeFile(path.join(root, "proof", "last-proof.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(root, "proof", "mechanical-report.json"), `${JSON.stringify({ schema_version: 1, generated_at: new Date().toISOString(), result: "pass", outcomes }, null, 2)}\n`, "utf8");
  console.log("PASS mechanical proof complete; visual reviews intentionally pending.");
} finally {
  for (const service of services) service.kill("SIGTERM");
}
