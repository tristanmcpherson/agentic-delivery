#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
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

function runNode(args) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr, duration_ms: Date.now() - started }));
  });
}

function ratio(numerator, denominator) { return denominator ? numerator / denominator : 1; }

function summarizeLegacyCompatibility(manifest, reports) {
  const observations = [];
  const missing = [];
  for (let repetition = 0; repetition < reports.length; repetition += 1) {
    const byId = new Map((reports[repetition].outcomes || []).map((outcome) => [outcome.id, outcome]));
    for (const definition of manifest.cases) {
      const outcome = byId.get(definition.id);
      if (!outcome) missing.push({ repetition: repetition + 1, id: definition.id });
      else observations.push({ repetition: repetition + 1, ...definition, outcome, conformant: outcome.matched_expectation === true });
    }
  }
  const defects = observations.filter((item) => item.kind === "defect");
  const healthy = observations.filter((item) => item.kind === "healthy");
  const nonconformances = observations.filter((item) => !item.conformant);
  const critical = nonconformances.filter((item) => item.critical);
  const defectNonconformances = defects.filter((item) => !item.conformant);
  const healthyNonconformances = healthy.filter((item) => !item.conformant);
  const expected = manifest.cases.length * reports.length;
  const metrics = {
    metric_semantics: "Prepared-case conformance only; legacy accessors are not empirical estimates.",
    repetitions: reports.length,
    expected_observations: expected,
    observed: observations.length,
    case_coverage: ratio(observations.length, expected),
    case_conformance: ratio(observations.length - nonconformances.length, expected),
    defect_case_conformance: ratio(defects.length - defectNonconformances.length, defects.length),
    healthy_case_conformance: ratio(healthy.length - healthyNonconformances.length, healthy.length),
    critical_case_nonconformances: critical.length,
    total_proof_duration_ms: reports.reduce((sum, report) => sum + Number(report.proof_duration_ms || 0), 0),
  };
  for (const [key, value] of Object.entries({
    defect_detection_recall: metrics.defect_case_conformance,
    healthy_false_block_rate: ratio(healthyNonconformances.length, healthy.length),
    critical_false_completions: critical.length,
  })) Object.defineProperty(metrics, key, { value, enumerable: false });
  const thresholds = manifest.thresholds;
  const passed = missing.length === 0
    && critical.length <= thresholds.critical_false_completions_max
    && metrics.defect_case_conformance >= thresholds.defect_detection_recall_min
    && ratio(healthyNonconformances.length, healthy.length) <= thresholds.healthy_false_block_rate_max
    && metrics.case_coverage >= thresholds.case_coverage_min;
  return {
    metrics,
    missing,
    invalid_reports: [],
    critical_nonconformances: critical,
    defect_nonconformances: defectNonconformances,
    healthy_nonconformances: healthyNonconformances,
    passed,
  };
}

function validateOutcome(definition, outcome, frozenExpectation) {
  const errors = [];
  if (outcome.kind !== definition.kind) errors.push(`case ${definition.id} kind contradicts frozen manifest`);
  if (outcome.expectation?.process !== frozenExpectation.process || outcome.expectation?.output !== frozenExpectation.output) {
    errors.push(`case ${definition.id} contradicts frozen manifest expectation`);
  }
  const observation = outcome.observation;
  const conformant = observation?.execution === "completed"
    && observation.process === frozenExpectation.process
    && observation.output === frozenExpectation.output;
  if (typeof outcome.matched_expectation === "boolean" && outcome.matched_expectation !== conformant) {
    errors.push(`case ${definition.id} has contradictory matched_expectation`);
  }
  if (typeof outcome.expected_process_success === "boolean" && outcome.expected_process_success !== (outcome.expectation?.process === "success")) {
    errors.push(`case ${definition.id} has contradictory legacy expected process`);
  }
  if (typeof outcome.observed_process_success === "boolean" && outcome.observed_process_success !== (observation?.process === "success")) {
    errors.push(`case ${definition.id} has contradictory legacy observed process`);
  }
  return { errors, conformant };
}

export function summarizePilot(manifest, reports, context = {}) {
  if (manifest.schema_version !== 2) return summarizeLegacyCompatibility(manifest, reports);
  const now = Number(context.now_ms ?? Date.now());
  const expectedHash = String(context.manifest_sha256 || "");
  const caseById = new Map(manifest.cases.map((definition) => [definition.id, definition]));
  const observations = [];
  const missing = [];
  const invalidReports = reports.length ? [] : [{ repetition: 0, errors: ["no proof reports"] }];
  for (let repetition = 0; repetition < reports.length; repetition += 1) {
    const report = reports[repetition];
    const errors = [];
    if (report.schema_version !== 2) errors.push(`unsupported report schema ${String(report.schema_version)}`);
    if (report.result !== "pass") errors.push(`top-level result is ${String(report.result)}`);
    if (report.read_error) errors.push(`report could not be read: ${report.read_error}`);
    if (Number.isInteger(report.producer_exit_code) && report.producer_exit_code !== 0) errors.push(`producer exited ${report.producer_exit_code}`);
    if (!report.binding) errors.push("unbound report");
    else {
      if (report.binding.manifest_name !== manifest.name || report.binding.manifest_schema_version !== manifest.schema_version) errors.push("manifest identity binding mismatch");
      if (!expectedHash || report.binding.manifest_sha256 !== expectedHash) errors.push("manifest hash binding mismatch");
    }
    const generatedAt = Date.parse(report.generated_at);
    if (!Number.isFinite(generatedAt)) errors.push("invalid report generation time");
    else if (now - generatedAt > manifest.report_max_age_seconds * 1_000) errors.push("stale report");
    else if (generatedAt - now > 300_000) errors.push("report generation time is implausibly future-dated");
    const seen = new Set();
    for (const outcome of Array.isArray(report.outcomes) ? report.outcomes : []) {
      if (!caseById.has(outcome?.id)) {
        errors.push(`unexpected case ${String(outcome?.id)}`);
        continue;
      }
      if (seen.has(outcome.id)) {
        errors.push(`duplicate case ${outcome.id}`);
        continue;
      }
      seen.add(outcome.id);
      const definition = caseById.get(outcome.id);
      const frozenExpectation = manifest.expectation_rules?.[definition.kind];
      if (!frozenExpectation) {
        errors.push(`case ${outcome.id} has no frozen expectation rule`);
        continue;
      }
      const validated = validateOutcome(definition, outcome, frozenExpectation);
      errors.push(...validated.errors);
      observations.push({ repetition: repetition + 1, ...definition, outcome, conformant: validated.conformant });
      if (report.result === "pass" && !validated.conformant) errors.push(`top-level pass contradicts nonconforming case ${outcome.id}`);
    }
    if (!Array.isArray(report.outcomes)) errors.push("outcomes must be an array");
    for (const definition of manifest.cases) {
      if (!seen.has(definition.id)) {
        missing.push({ repetition: repetition + 1, id: definition.id });
        errors.push(`missing case ${definition.id}`);
      }
    }
    if (errors.length) invalidReports.push({ repetition: repetition + 1, errors });
  }
  const expected = manifest.cases.length * reports.length;
  const expectedByKind = (kind) => manifest.cases.filter((item) => item.kind === kind).length * reports.length;
  const conforming = observations.filter((item) => item.conformant);
  const conformingByKind = (kind) => conforming.filter((item) => item.kind === kind).length;
  const criticalExpected = manifest.cases.filter((item) => item.critical).length * reports.length;
  const criticalConforming = conforming.filter((item) => item.critical).length;
  const nonconformances = observations.filter((item) => !item.conformant);
  const metrics = {
    metric_semantics: "Prepared-case conformance only; these are not empirical efficacy estimates.",
    repetitions: reports.length,
    expected_observations: expected,
    observed: observations.length,
    case_coverage: ratio(observations.length, expected),
    case_conformance: ratio(conforming.length, expected),
    defect_case_conformance: ratio(conformingByKind("defect"), expectedByKind("defect")),
    healthy_case_conformance: ratio(conformingByKind("healthy"), expectedByKind("healthy")),
    control_case_conformance: ratio(conformingByKind("control"), expectedByKind("control")),
    critical_case_nonconformances: criticalExpected - criticalConforming,
    total_proof_duration_ms: reports.reduce((sum, report) => sum + Number(report.proof_duration_ms || 0), 0),
  };
  const thresholds = manifest.thresholds;
  const passed = invalidReports.length === 0
    && metrics.critical_case_nonconformances <= thresholds.critical_case_nonconformances_max
    && metrics.case_conformance >= thresholds.case_conformance_min
    && metrics.case_coverage >= thresholds.case_coverage_min;
  return {
    metrics,
    missing,
    invalid_reports: invalidReports,
    critical_nonconformances: nonconformances.filter((item) => item.critical),
    defect_nonconformances: nonconformances.filter((item) => item.kind === "defect"),
    healthy_nonconformances: nonconformances.filter((item) => item.kind === "healthy"),
    passed,
  };
}

function validateManifest(manifest) {
  const ids = Array.isArray(manifest.cases) ? manifest.cases.map((definition) => definition.id) : [];
  return manifest.schema_version === 2 && typeof manifest.name === "string" && ids.length > 0 && manifest.thresholds
    && Number.isInteger(manifest.report_max_age_seconds) && manifest.report_max_age_seconds > 0 && new Set(ids).size === ids.length
    && manifest.cases.every((definition) => manifest.expectation_rules?.[definition.kind]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestFile = path.resolve(root, String(args.manifest || "evaluation/pilot-manifest.json"));
  const manifestText = await fs.readFile(manifestFile, "utf8");
  const manifest = JSON.parse(manifestText);
  if (!validateManifest(manifest)) throw new Error("Invalid evaluation manifest.");
  const repetitions = Number(args.repetitions || manifest.default_repetitions || 1);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error("--repetitions must be an integer from 1 to 100.");
  if (args["use-report"] && repetitions !== 1) throw new Error("--use-report supports exactly one repetition.");
  const reportFile = path.resolve(root, String(args["use-report"] || "proof/mechanical-report.json"));
  const reports = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    let duration = 0;
    let producerExitCode = null;
    if (!args["use-report"]) {
      console.log(`Running proof repetition ${repetition}/${repetitions}`);
      await fs.rm(reportFile, { force: true });
      const result = await runNode([path.join(root, "proof", "run-proof.mjs")]);
      duration = result.duration_ms;
      producerExitCode = result.code;
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
    }
    let report;
    try {
      report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    } catch (error) {
      report = { schema_version: 0, generated_at: new Date().toISOString(), result: "fail", outcomes: [], read_error: error.message };
    }
    reports.push({ ...report, proof_duration_ms: duration, producer_exit_code: producerExitCode });
  }
  const summary = summarizePilot(manifest, reports, {
    manifest_sha256: createHash("sha256").update(manifestText).digest("hex"),
    now_ms: Date.now(),
  });
  const output = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    manifest: path.relative(root, manifestFile).replaceAll("\\", "/"),
    result: summary.passed ? "pass" : "fail",
    ...summary,
  };
  const outputFile = path.resolve(root, String(args.output || "evaluation/results/pilot-latest.json"));
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Pilot ${output.result}: conformance=${summary.metrics.case_conformance.toFixed(3)}, coverage=${summary.metrics.case_coverage.toFixed(3)}`);
  console.log(`Report: ${outputFile}`);
  if (!summary.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
