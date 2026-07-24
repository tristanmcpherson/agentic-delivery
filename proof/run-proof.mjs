import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

export function recordProofOutcome(recordedOutcomes, input) {
  const expectedProcess = input.shouldPass ? "success" : "failure";
  const observedProcess = input.result.code === 0 ? "success" : "failure";
  const observedOutput = input.outputMatched ? "match" : "mismatch";
  const matchedExpectation = observedProcess === expectedProcess && observedOutput === "match";
  const outcome = {
    id: input.id,
    kind: input.kind,
    label: input.label,
    expectation: { process: expectedProcess, output: "match" },
    observation: { execution: "completed", process: observedProcess, output: observedOutput },
    matched_expectation: matchedExpectation,
    duration_ms: input.result.duration_ms,
  };
  recordedOutcomes.push(outcome);
  return outcome;
}

export function createMechanicalReport(input) {
  const definitions = new Map(input.manifest.cases.map((definition) => [definition.id, definition]));
  const byId = new Map();
  const extras = [];
  for (const outcome of input.outcomes) {
    if (!definitions.has(outcome.id) || byId.has(outcome.id)) extras.push(outcome);
    else byId.set(outcome.id, outcome);
  }
  const prepared = input.manifest.cases.map((definition) => byId.get(definition.id) || {
    id: definition.id,
    kind: definition.kind,
    label: definition.id,
    expectation: { ...input.manifest.expectation_rules[definition.kind] },
    observation: { execution: "not-run", process: "not-observed", output: "not-observed" },
    matched_expectation: false,
    duration_ms: 0,
    failure: input.failureMessage || "prepared case was not executed",
  });
  const complete = extras.length === 0 && prepared.every((outcome) => outcome.matched_expectation === true);
  return {
    schema_version: 2,
    generated_at: input.generatedAt || new Date().toISOString(),
    result: complete && !input.failureMessage ? "pass" : "fail",
    binding: {
      manifest_name: input.manifest.name,
      manifest_schema_version: input.manifest.schema_version,
      manifest_sha256: input.manifestSha256,
    },
    compatibility: {
      matched_expectation_authority: "non-authoritative",
    },
    outcomes: [...prepared, ...extras],
  };
}

function expectResult(input) {
  const outputMatched = !input.pattern || input.pattern.test(`${input.result.stdout}\n${input.result.stderr}`);
  const outcome = recordProofOutcome(outcomes, { ...input, outputMatched });
  if (outcome.matched_expectation) console.log(`${input.shouldPass ? "PASS" : "EXPECTED FAIL"} ${input.label}`);
  else console.error(`UNEXPECTED ${input.label} (${input.result.code}).\n${input.result.stdout}\n${input.result.stderr}`);
}

async function harnessRun(command, task, extra = []) {
  return runNode([harness, command, "--root", root, "--config", config, "--task", path.join(root, "proof", "tasks", task), ...extra]);
}

async function runProof() {
outcomes.length = 0;
const manifestFile = path.join(root, "evaluation", "pilot-manifest.json");
const manifestText = await fs.readFile(manifestFile, "utf8");
const manifest = JSON.parse(manifestText);
const services = [];
let fatalError = null;
try {
  const discovery = await harnessRun("validate-task", "discovery-healthy.json");
  expectResult({ id: "discovery-contract-healthy", kind: "healthy", label: "resolved read-only discovery contract is accepted", result: discovery, shouldPass: true, pattern: /Valid task contract: PROOF-DISCOVERY-HEALTHY/ });

  const goalSpec = await harnessRun("goal-spec", "discovery-healthy.json", ["--json"]);
  expectResult({ id: "goal-spec-bound", kind: "healthy", label: "canonical goal binds contract acceptance and completion target", result: goalSpec, shouldPass: true, pattern: /"acceptance_ids"[\s\S]*"AC-PARSER"[\s\S]*"intent_sha256": "[a-f0-9]{64}"/ });

  const unresolvedDiscovery = await harnessRun("validate-task", "discovery-unresolved.json");
  expectResult({ id: "discovery-material-unresolved", kind: "defect", label: "unresolved material discovery blocks contract readiness", result: unresolvedDiscovery, shouldPass: false, pattern: /material intake question RQ-MATERIAL must be resolved[\s\S]*unresolved_material must be empty/ });

  const unsafeScout = await harnessRun("validate-task", "discovery-unsafe-scout.json");
  expectResult({ id: "discovery-scout-write", kind: "defect", label: "write-capable scout claims and raw transcripts are rejected", result: unsafeScout, shouldPass: false, pattern: /scope must be read-only[\s\S]*must not embed transcript/ });

  const goalDrift = await harnessRun("validate-task", "goal-contract-drift.json");
  expectResult({ id: "goal-contract-drift", kind: "defect", label: "goal acceptance cannot drift from the frozen contract", result: goalDrift, shouldPass: false, pattern: /goal_spec.acceptance_ids must exactly match task acceptance ids/ });

  const graphContract = await harnessRun("validate-task", "execution-graph-healthy.json");
  expectResult({ id: "execution-graph-contract", kind: "healthy", label: "bounded execution graph contract is accepted", result: graphContract, shouldPass: true, pattern: /Valid task contract: PROOF-EXECUTION-GRAPH-HEALTHY/ });

  const graphPlan = await harnessRun("graph-plan", "execution-graph-healthy.json", ["--json"]);
  expectResult({ id: "execution-graph-plan", kind: "healthy", label: "independent isolated nodes fan out before serialized integration", result: graphPlan, shouldPass: true, pattern: /"node_ids": \[[\s\S]*"implement-parser"[\s\S]*"audit-test-gap"[\s\S]*"unblocks_fan_in": \[[\s\S]*"integrate-parser"/ });

  const graphCycle = await harnessRun("validate-task", "execution-graph-cycle.json");
  expectResult({ id: "execution-graph-cycle", kind: "defect", label: "cyclic execution graph is rejected", result: graphCycle, shouldPass: false, pattern: /execution_graph must be acyclic/ });

  const graphAuthority = await harnessRun("validate-task", "execution-graph-authority.json");
  expectResult({ id: "execution-graph-authority", kind: "defect", label: "builder graph cannot claim protected verifier authority", result: graphAuthority, shouldPass: false, pattern: /executor is unsupported and cannot claim verifier or delivery authority/ });

  const rawPromptGoal = await runNode([lifecycle, "activate", "--root", root, "--task", path.join(root, "proof", "tasks", "discovery-healthy.json")]);
  expectResult({ id: "goal-intent-required", kind: "defect", label: "raw prompt activation cannot bypass canonical goal reconciliation", result: rawPromptGoal, shouldPass: false, pattern: /Pass --goal-intent/ });

  const missingRiskGate = await harnessRun("validate-task", "risk-gate-missing.json");
  expectResult({ id: "risk-gate-missing", kind: "defect", label: "a declared security risk cannot omit its direct gate", result: missingRiskGate, shouldPass: false, pattern: /risk security has no required direct gate/ });

  const fastRiskBypass = await harnessRun("validate-task", "risk-gate-fast-bypass.json");
  expectResult({ id: "risk-gate-fast-bypass", kind: "defect", label: "planning size cannot turn a security integration gate into a fast-only check", result: fastRiskBypass, shouldPass: false, pattern: /risk security gate too-fast must run at integration/ });

  const continuationGuards = await runNode(["--test", "--test-name-pattern", "continuation halts", path.join(root, "test", "agentic-lifecycle.test.mjs")]);
  expectResult({ id: "continuation-guards", kind: "healthy", label: "bounded continuation halts on repeated no-progress, authorization, reentrancy, and context pressure", result: continuationGuards, shouldPass: true, pattern: /pass 1/ });

  const advisoryBinding = await runNode(["--test", "--test-name-pattern", "advisory reviews are bound", path.join(root, "test", "agentic-assurance.test.mjs")]);
  expectResult({ id: "advisory-hash-binding", kind: "healthy", label: "advisory review is current-attempt and artifact-hash bound", result: advisoryBinding, shouldPass: true, pattern: /pass 1/ });

  const deliveryBinding = await runNode(["--test", "--test-name-pattern", "delivered-and-verified requires", path.join(root, "test", "agentic-assurance.test.mjs")]);
  expectResult({ id: "protected-delivery-binding", kind: "healthy", label: "protected delivery requires distinct signed controller and exact closure bindings", result: deliveryBinding, shouldPass: true, pattern: /pass 1/ });

  const deliveryWithoutClosure = await harnessRun("delivery-request", "production-sim.json", ["--target", "production", "--deployment-id", "production-fixture-v1", "--approval-id", "APP-PROOF", "--approved-by", "proof-owner", "--approved-at", "2026-07-14T16:00:00.000Z"]);
  expectResult({ id: "delivery-without-closure", kind: "defect", label: "local or incomplete evidence cannot request delivered-and-verified authority", result: deliveryWithoutClosure, shouldPass: false, pattern: /requires current protected closure evidence/ });

  const invalid = await harnessRun("validate-task", "mock-only-invalid.json");
  expectResult({ id: "mock-only-contract", kind: "defect", label: "mock-only task contract is rejected", result: invalid, shouldPass: false, pattern: /real-service UI check/ });

  const unit = await harnessRun("run", "healthy.json", ["--check", "unit-profile-contract"]);
  expectResult({ id: "focused-unit", kind: "healthy", label: "focused unit contract", result: unit, shouldPass: true, pattern: /PASS unit-profile-contract/ });

  const mockUi = start("proof/fixture/ui-server.mjs", ["--port", "46200", "--api-origin", "http://127.0.0.1:46201"]);
  services.push(mockUi);
  await waitFor("http://127.0.0.1:46200/health");
  const mock = await harnessRun("run", "healthy.json", ["--check", "ui-mocked"]);
  expectResult({ id: "mocked-partial-control", kind: "control", label: "mocked browser journey passes but remains partial", result: mock, shouldPass: true, pattern: /PASS ui-mocked/ });
  await stop(mockUi);
  services.splice(services.indexOf(mockUi), 1);

  const brokenApi = start("proof/fixture/api-server.mjs", ["--port", "46201", "--mode", "broken", "--marker", "broken-local", "--allow-origin", "http://127.0.0.1:46200"]);
  const brokenUi = start("proof/fixture/ui-server.mjs", ["--port", "46200", "--api-origin", "http://127.0.0.1:46201"]);
  services.push(brokenApi, brokenUi);
  await waitFor("http://127.0.0.1:46201/health");
  await waitFor("http://127.0.0.1:46200/health");
  const broken = await harnessRun("run", "broken-real.json");
  expectResult({ id: "real-api-mismatch", kind: "defect", label: "real API incompatibility is detected", result: broken, shouldPass: false, pattern: /FAIL ui-real-broken/ });
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
  expectResult({ id: "mixed-real-healthy", kind: "healthy", label: "mixed UI and development API pass with attestation", result: mixed, shouldPass: true, pattern: /PASS ui-mixed-real/ });

  const businessMocked = await harnessRun("run", "business-call-mocked.json");
  expectResult({ id: "business-request-mocked", kind: "defect", label: "a correct health probe cannot hide a mocked business request", result: businessMocked, shouldPass: false, pattern: /first-party mock|business response/ });

  const missingTest = await harnessRun("run", "missing-required-test.json");
  expectResult({ id: "missing-required-test", kind: "defect", label: "a green command cannot omit the required test", result: missingTest, shouldPass: false, pattern: /required test was not collected/ });

  const retryOnly = await harnessRun("run", "retry-only.json");
  expectResult({ id: "retry-only", kind: "defect", label: "retry-only success is not clean verification", result: retryOnly, shouldPass: false, pattern: /required a retry/ });

  const spoofApi = start("proof/fixture/api-server.mjs", ["--port", "46206", "--mode", "healthy", "--marker", "development", "--deployment-id", "attacker-fixture-v1", "--allow-origin", "http://127.0.0.1:46207"]);
  const spoofUi = start("proof/fixture/ui-server.mjs", ["--port", "46207", "--api-origin", "http://127.0.0.1:46206"]);
  services.push(spoofApi, spoofUi);
  await waitFor("http://127.0.0.1:46206/health");
  await waitFor("http://127.0.0.1:46207/health");
  const markerSpoof = await harnessRun("run", "marker-spoof.json");
  expectResult({ id: "marker-spoof", kind: "defect", label: "a copied environment marker cannot spoof deployment identity", result: markerSpoof, shouldPass: false, pattern: /deployment identity/ });

  const nonUi = await harnessRun("run", "non-ui-healthy.json");
  expectResult({ id: "non-ui-healthy", kind: "healthy", label: "real SQLite migration and asynchronous worker checks pass", result: nonUi, shouldPass: true, pattern: /PASS sqlite-migration[\s\S]*PASS async-projection/ });
  const brokenMigration = await harnessRun("run", "migration-broken.json");
  expectResult({ id: "migration-backfill-missing", kind: "defect", label: "a green migration command cannot hide a missing backfill", result: brokenMigration, shouldPass: false, pattern: /data-preserved/ });
  const brokenAsync = await harnessRun("run", "async-broken.json");
  expectResult({ id: "async-postcondition-missing", kind: "defect", label: "worker acknowledgement cannot hide wrong correlation and missing postcondition", result: brokenAsync, shouldPass: false, pattern: /correlation-matched.*postcondition-observed/ });

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
  expectResult({ id: "false-closure-config-flip", kind: "defect", label: "a local verifier-mode config flip cannot issue closure", result: falseClosure, shouldPass: false, pattern: /requires a signed verifier grant/ });

  const productionApi = start("proof/fixture/api-server.mjs", ["--port", "46204", "--mode", "healthy", "--marker", "production", "--allow-origin", "http://127.0.0.1:46205"]);
  const productionUi = start("proof/fixture/ui-server.mjs", ["--port", "46205", "--api-origin", "http://127.0.0.1:46204"]);
  services.push(productionApi, productionUi);
  await waitFor("http://127.0.0.1:46204/health");
  await waitFor("http://127.0.0.1:46205/health");
  const unapproved = await harnessRun("run", "production-sim.json");
  expectResult({ id: "production-unapproved", kind: "defect", label: "production profile refuses implicit execution", result: unapproved, shouldPass: false, pattern: /requires --approve-external/ });
  const approved = await harnessRun("run", "production-sim.json", ["--approve-external"]);
  expectResult({ id: "production-approved", kind: "healthy", label: "approved safe production simulation passes", result: approved, shouldPass: true, pattern: /PASS production-smoke/ });

  const healthyStatus = JSON.parse(await fs.readFile(path.join(root, "proof", "evidence", "PROOF-HEALTHY", "latest.json"), "utf8"));
  const productionStatus = JSON.parse(await fs.readFile(path.join(root, "proof", "evidence", "PROOF-PRODUCTION", "latest.json"), "utf8"));
  const nonUiStatus = JSON.parse(await fs.readFile(path.join(root, "proof", "evidence", "PROOF-NON-UI", "latest.json"), "utf8"));
  const report = {
    generated_at: new Date().toISOString(),
    mechanical_proof: outcomes.every((outcome) => outcome.matched_expectation === true) ? "pass" : "fail",
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
} catch (error) {
  fatalError = error;
} finally {
  for (const service of services) service.kill("SIGTERM");
}
const mechanicalReport = createMechanicalReport({
  manifest,
  manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
  outcomes,
  failureMessage: fatalError?.message,
});
await fs.writeFile(path.join(root, "proof", "mechanical-report.json"), `${JSON.stringify(mechanicalReport, null, 2)}\n`, "utf8");
if (mechanicalReport.result === "pass") console.log("PASS mechanical proof complete; visual reviews intentionally pending.");
else {
  console.error(`FAIL mechanical proof recorded ${mechanicalReport.outcomes.length} prepared outcomes.${fatalError ? ` ${fatalError.message}` : ""}`);
  process.exitCode = 1;
}
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) runProof().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
