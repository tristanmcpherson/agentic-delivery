#!/usr/bin/env node

import { spawn } from "node:child_process";
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

export function summarizePilot(manifest, reports) {
  const observations = [];
  const missing = [];
  for (let repetition = 0; repetition < reports.length; repetition += 1) {
    const byId = new Map((reports[repetition].outcomes || []).map((outcome) => [outcome.id, outcome]));
    for (const definition of manifest.cases) {
      const outcome = byId.get(definition.id);
      if (!outcome) {
        missing.push({ repetition: repetition + 1, id: definition.id });
        continue;
      }
      observations.push({ repetition: repetition + 1, ...definition, outcome });
    }
  }
  const defects = observations.filter((item) => item.kind === "defect");
  const healthy = observations.filter((item) => item.kind === "healthy");
  const criticalFalseCompletions = defects.filter((item) => item.critical && item.outcome.matched_expectation !== true);
  const undetected = defects.filter((item) => item.outcome.matched_expectation !== true);
  const falseBlocks = healthy.filter((item) => item.outcome.matched_expectation !== true);
  const expectedCount = manifest.cases.length * reports.length;
  const metrics = {
    repetitions: reports.length,
    expected_observations: expectedCount,
    observed: observations.length,
    case_coverage: expectedCount ? observations.length / expectedCount : 0,
    defects: defects.length,
    defects_detected: defects.length - undetected.length,
    defect_detection_recall: defects.length ? (defects.length - undetected.length) / defects.length : 0,
    critical_false_completions: criticalFalseCompletions.length,
    healthy_runs: healthy.length,
    healthy_false_blocks: falseBlocks.length,
    healthy_false_block_rate: healthy.length ? falseBlocks.length / healthy.length : 0,
    total_proof_duration_ms: reports.reduce((sum, report) => sum + Number(report.proof_duration_ms || 0), 0),
  };
  const thresholds = manifest.thresholds;
  const passed = missing.length === 0
    && metrics.critical_false_completions <= thresholds.critical_false_completions_max
    && metrics.defect_detection_recall >= thresholds.defect_detection_recall_min
    && metrics.healthy_false_block_rate <= thresholds.healthy_false_block_rate_max
    && metrics.case_coverage >= thresholds.case_coverage_min;
  return { metrics, missing, critical_false_completions: criticalFalseCompletions, undetected_defects: undetected, false_blocks: falseBlocks, passed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestFile = path.resolve(root, String(args.manifest || "evaluation/pilot-manifest.json"));
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.cases) || !manifest.thresholds) throw new Error("Invalid evaluation manifest.");
  const repetitions = Number(args.repetitions || manifest.default_repetitions || 1);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error("--repetitions must be an integer from 1 to 100.");
  if (args["use-report"] && repetitions !== 1) throw new Error("--use-report supports exactly one repetition.");
  const reports = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    let duration = 0;
    if (!args["use-report"]) {
      console.log(`Running proof repetition ${repetition}/${repetitions}`);
      const result = await runNode([path.join(root, "proof", "run-proof.mjs")]);
      duration = result.duration_ms;
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      if (result.code !== 0) throw new Error(`Proof repetition ${repetition} failed with exit code ${result.code}.`);
    }
    const reportFile = path.resolve(root, String(args["use-report"] || "proof/mechanical-report.json"));
    const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    reports.push({ ...report, proof_duration_ms: duration });
  }
  const summary = summarizePilot(manifest, reports);
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    manifest: path.relative(root, manifestFile).replaceAll("\\", "/"),
    result: summary.passed ? "pass" : "fail",
    ...summary,
  };
  const outputFile = path.resolve(root, String(args.output || "evaluation/results/pilot-latest.json"));
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Pilot ${output.result}: recall=${summary.metrics.defect_detection_recall.toFixed(3)}, false-block-rate=${summary.metrics.healthy_false_block_rate.toFixed(3)}, coverage=${summary.metrics.case_coverage.toFixed(3)}`);
  console.log(`Report: ${outputFile}`);
  if (!summary.passed) process.exitCode = 1;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
