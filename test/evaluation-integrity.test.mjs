import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as proofProducer from "../proof/run-proof.mjs";
import { summarizePilot } from "../scripts/run-evaluation.mjs";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

function fixtureManifest() {
  return {
    schema_version: 2,
    name: "evaluation-integrity-fixture",
    report_max_age_seconds: 60,
    expectation_rules: {
      defect: { process: "failure", output: "match" },
      healthy: { process: "success", output: "match" },
      control: { process: "success", output: "match" },
    },
    cases: [
      { id: "defect", kind: "defect", category: "security", critical: true },
      { id: "healthy", kind: "healthy", category: "logic", critical: false },
    ],
    thresholds: {
      critical_case_nonconformances_max: 0,
      case_conformance_min: 1,
      case_coverage_min: 1,
    },
  };
}

function manifestDigest(manifest) {
  return createHash("sha256").update(`${JSON.stringify(manifest, null, 2)}\n`).digest("hex");
}

function fixtureOutcome(id, kind, expectedProcess, observedProcess) {
  return {
    id,
    kind,
    label: `${id} fixture`,
    expectation: { process: expectedProcess, output: "match" },
    observation: { execution: "completed", process: observedProcess, output: "match" },
    matched_expectation: true,
    duration_ms: 1,
  };
}

function fixtureReport(manifest) {
  return {
    schema_version: 2,
    generated_at: new Date(NOW).toISOString(),
    result: "pass",
    binding: {
      manifest_name: manifest.name,
      manifest_schema_version: manifest.schema_version,
      manifest_sha256: manifestDigest(manifest),
    },
    outcomes: [
      fixtureOutcome("defect", "defect", "failure", "failure"),
      fixtureOutcome("healthy", "healthy", "success", "success"),
    ],
  };
}

function summarize(manifest, report) {
  return summarizePilot(manifest, [report], {
    manifest_sha256: manifestDigest(manifest),
    now_ms: NOW,
  });
}

test("pilot reducer derives prepared-case conformance from typed observations", () => {
  // Given: a complete, fresh report bound to the exact frozen manifest.
  const manifest = fixtureManifest();
  const report = fixtureReport(manifest);

  // When: the reducer independently compares manifest expectations with observations.
  const summary = summarize(manifest, report);

  // Then: conformance passes without publishing empirical recall or false-block metrics.
  assert.equal(summary.passed, true);
  assert.equal(summary.metrics.case_conformance, 1);
  assert.equal(summary.metrics.defect_case_conformance, 1);
  assert.equal(summary.metrics.healthy_case_conformance, 1);
  assert.equal(JSON.stringify(summary).includes("defect_detection_recall"), false);
  assert.equal(JSON.stringify(summary).includes("healthy_false_block_rate"), false);
});

test("pilot reducer rejects a producer match boolean that contradicts typed observations", () => {
  // Given: a report claiming a match while the defect process unexpectedly succeeds.
  const manifest = fixtureManifest();
  const report = fixtureReport(manifest);
  report.outcomes[0].observation.process = "success";

  // When: the report is reduced.
  const summary = summarize(manifest, report);

  // Then: the typed mismatch wins and the producer-authored boolean is contradictory.
  assert.equal(summary.passed, false);
  assert.equal(summary.metrics.defect_case_conformance, 0);
  assert.ok(summary.invalid_reports[0].errors.some((error) => error.includes("contradictory matched_expectation")));
});

test("pilot reducer fails closed for malformed or inapplicable proof reports", async (t) => {
  const cases = [
    {
      name: "missing membership",
      mutate(report) { report.outcomes.pop(); },
      expected: "missing case healthy",
    },
    {
      name: "duplicate membership",
      mutate(report) { report.outcomes.push(structuredClone(report.outcomes[0])); },
      expected: "duplicate case defect",
    },
    {
      name: "unexpected membership",
      mutate(report) { report.outcomes.push(fixtureOutcome("unknown", "healthy", "success", "success")); },
      expected: "unexpected case unknown",
    },
    {
      name: "contradictory expectation",
      mutate(report) { report.outcomes[0].expectation.process = "success"; },
      expected: "contradicts frozen manifest expectation",
    },
    {
      name: "stale generation",
      mutate(report) { report.generated_at = new Date(NOW - 61_000).toISOString(); },
      expected: "stale report",
    },
    {
      name: "missing binding",
      mutate(report) { delete report.binding; },
      expected: "unbound report",
    },
    {
      name: "wrong manifest hash",
      mutate(report) { report.binding.manifest_sha256 = "0".repeat(64); },
      expected: "manifest hash binding mismatch",
    },
    {
      name: "top-level failure",
      mutate(report) { report.result = "fail"; },
      expected: "top-level result is fail",
    },
    {
      name: "unsupported report schema",
      mutate(report) { report.schema_version = 1; },
      expected: "unsupported report schema 1",
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      // Given: one otherwise valid report with exactly one integrity defect.
      const manifest = fixtureManifest();
      const report = fixtureReport(manifest);
      fixture.mutate(report);

      // When: the reducer validates the report before aggregating it.
      const summary = summarize(manifest, report);

      // Then: the report is explicitly rejected for the named defect.
      assert.equal(summary.passed, false);
      assert.ok(summary.invalid_reports[0].errors.some((error) => error.includes(fixture.expected)), JSON.stringify(summary.invalid_reports));
    });
  }
});

test("pilot reducer rejects an empty report set", () => {
  // Given: a frozen manifest but no producer report.
  const manifest = fixtureManifest();

  // When: the reducer is asked to aggregate no evidence.
  const summary = summarizePilot(manifest, [], { manifest_sha256: manifestDigest(manifest), now_ms: NOW });

  // Then: absence cannot become vacuous conformance.
  assert.equal(summary.passed, false);
  assert.ok(summary.invalid_reports[0].errors.includes("no proof reports"));
});

test("proof recorder retains later prepared outcomes after an earlier mismatch", () => {
  // Given: an early unexpected success followed by a conforming healthy case.
  assert.equal(typeof proofProducer.recordProofOutcome, "function");
  const outcomes = [];

  // When: both completed results are recorded without fail-fast control flow.
  const mismatch = proofProducer.recordProofOutcome(outcomes, {
    id: "defect",
    kind: "defect",
    label: "unexpected success",
    result: { code: 0, duration_ms: 2 },
    shouldPass: false,
    outputMatched: true,
  });
  const conforming = proofProducer.recordProofOutcome(outcomes, {
    id: "healthy",
    kind: "healthy",
    label: "healthy success",
    result: { code: 0, duration_ms: 3 },
    shouldPass: true,
    outputMatched: true,
  });

  // Then: the mismatch is data, not an exception that suppresses later evidence.
  assert.equal(mismatch.matched_expectation, false);
  assert.equal(conforming.matched_expectation, true);
  assert.deepEqual(outcomes.map((outcome) => outcome.id), ["defect", "healthy"]);
});

test("mechanical report records every frozen case before returning failure", () => {
  // Given: one recorded mismatch and one prepared case that could not run after a fatal error.
  assert.equal(typeof proofProducer.createMechanicalReport, "function");
  const manifest = fixtureManifest();
  const outcomes = [];
  proofProducer.recordProofOutcome(outcomes, {
    id: "defect",
    kind: "defect",
    label: "unexpected success",
    result: { code: 0, duration_ms: 2 },
    shouldPass: false,
    outputMatched: true,
  });

  // When: the producer finalizes the failed run against frozen membership.
  const report = proofProducer.createMechanicalReport({
    manifest,
    manifestSha256: manifestDigest(manifest),
    outcomes,
    generatedAt: new Date(NOW).toISOString(),
    failureMessage: "fixture infrastructure stopped",
  });

  // Then: all case IDs are present and unexecuted work is explicit before failure.
  assert.equal(report.result, "fail");
  assert.deepEqual(report.outcomes.map((outcome) => outcome.id), ["defect", "healthy"]);
  assert.equal(report.outcomes[1].observation.execution, "not-run");
  assert.equal(report.outcomes[1].failure, "fixture infrastructure stopped");
  assert.equal(report.compatibility.matched_expectation_authority, "non-authoritative");
});
