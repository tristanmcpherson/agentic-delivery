import assert from "node:assert/strict";
import test from "node:test";
import {
  LIFECYCLE_PHASES,
  TERMINAL_STATES,
  acquireLifecycleLease,
  deriveMaterialProgressFingerprint,
  evaluateContinuation,
  selectLifecycleAction,
  terminalForBeadStatus,
  transitionLifecycle,
} from "../plugins/vision/scripts/lifecycle-model.mjs";

const policy = {
  max_no_progress_resumes: 2,
  max_authorization_failures: 3,
  max_context_percent: 80,
};

function state(overrides = {}) {
  return {
    revision: 0,
    phase: "implement",
    phase_entered_at: "2026-07-16T00:00:00.000Z",
    terminal_state: null,
    lease: null,
    lease_generation: 0,
    current_slice: { id: "slice-1", summary: "Implement the bounded slice." },
    completion_target: "locally-verified",
    guards: null,
    ...overrides,
  };
}

test("lifecycle exposes only explicit phases and typed terminal states", () => {
  assert.deepEqual(LIFECYCLE_PHASES, ["implement", "verify", "diagnose", "protected-closure", "deliver"]);
  assert.deepEqual(TERMINAL_STATES, ["verified", "blocked", "failed", "cancelled", "paused", "budget-exhausted"]);
  assert.equal(terminalForBeadStatus("blocked"), "blocked");
  assert.equal(terminalForBeadStatus("paused"), "paused");
  assert.equal(terminalForBeadStatus("cancelled"), "cancelled");
  assert.equal(terminalForBeadStatus("in_progress"), null);
});

test("lease acquisition fences stale revisions, owners, tokens, and expiry", () => {
  const leased = acquireLifecycleLease(state(), {
    expected_revision: 0,
    owner: "controller-a",
    token: "token-a",
    now_ms: 1_000,
    ttl_ms: 5_000,
  });
  assert.equal(leased.revision, 1);
  assert.equal(leased.lease.owner, "controller-a");
  assert.equal(leased.lease.token, "token-a");
  assert.equal(leased.lease.generation, 1);
  assert.equal(leased.lease.expires_at, new Date(6_000).toISOString());

  assert.throws(() => acquireLifecycleLease(leased, {
    expected_revision: 0,
    owner: "controller-a",
    token: "token-a",
    now_ms: 2_000,
    ttl_ms: 5_000,
  }), /stale lifecycle revision/i);
  assert.throws(() => acquireLifecycleLease(leased, {
    expected_revision: 1,
    owner: "controller-b",
    token: "token-b",
    now_ms: 2_000,
    ttl_ms: 5_000,
  }), /leased by controller-a/i);

  const reclaimed = acquireLifecycleLease(leased, {
    expected_revision: 1,
    owner: "controller-b",
    token: "token-b",
    now_ms: 7_000,
    ttl_ms: 5_000,
  });
  assert.equal(reclaimed.lease.generation, 2);
  assert.equal(reclaimed.lease.owner, "controller-b");

  assert.throws(() => transitionLifecycle(reclaimed, {
    expected_revision: 2,
    lease_owner: "controller-a",
    lease_token: "token-a",
    now_ms: 8_000,
    phase: "verify",
  }), /lease owner/i);
  assert.throws(() => transitionLifecycle(reclaimed, {
    expected_revision: 2,
    lease_owner: "controller-b",
    lease_token: "wrong-token",
    now_ms: 8_000,
    phase: "verify",
  }), /lease token/i);
  assert.throws(() => transitionLifecycle(reclaimed, {
    expected_revision: 2,
    lease_owner: "controller-b",
    lease_token: "token-b",
    now_ms: 13_000,
    phase: "verify",
  }), /lease expired/i);
});

test("controller transitions increment revision and terminal states are immutable", () => {
  const leased = acquireLifecycleLease(state(), {
    expected_revision: 0,
    owner: "controller",
    token: "token",
    now_ms: 1_000,
    ttl_ms: 5_000,
  });
  const verified = transitionLifecycle(leased, {
    expected_revision: 1,
    lease_owner: "controller",
    lease_token: "token",
    now_ms: 2_000,
    phase: "verify",
    terminal_state: "verified",
    terminal_reason: "Current evidence reached the target.",
    release_lease: true,
  });
  assert.equal(verified.revision, 2);
  assert.equal(verified.phase, "verify");
  assert.equal(verified.lease, null);
  assert.deepEqual(verified.terminal_state, {
    kind: "verified",
    reason: "Current evidence reached the target.",
    at: new Date(2_000).toISOString(),
  });
  assert.throws(() => acquireLifecycleLease(verified, {
    expected_revision: 2,
    owner: "controller",
    token: "new-token",
    now_ms: 3_000,
    ttl_ms: 5_000,
  }), /terminal state verified/i);
  assert.throws(() => transitionLifecycle(leased, {
    expected_revision: 1,
    lease_owner: "controller",
    lease_token: "token",
    now_ms: 2_000,
    phase: "invented",
  }), /unsupported lifecycle phase/i);
});

test("material progress ignores arbitrary caller nonce and tracks bound candidate, evidence, and acceptance", () => {
  const snapshot = {
    contract_hash: "contract-a",
    candidate_id: "candidate-a",
    workspace_candidate_sha256: "workspace-a",
    evidence: {
      content_sha256: "evidence-a",
      contract_hash: "contract-a",
      candidate_id: "candidate-a",
      workspace_fingerprint: "workspace-a",
      config_hash: "config-a",
      harness_hash: "harness-a",
      overall_status: "implemented-not-verified",
      criteria: [{ id: "AC-1", status: "not-proven" }],
      checks: [{ id: "focused", state: "missing" }],
    },
    acceptance: [{ id: "AC-1", behavior_sha256: "behavior-a" }],
  };
  const first = deriveMaterialProgressFingerprint({ ...snapshot, nonce: "caller-a" });
  const second = deriveMaterialProgressFingerprint({ ...snapshot, nonce: "caller-b" });
  assert.equal(first, second, "caller-controlled nonce changed material progress");
  assert.notEqual(first, deriveMaterialProgressFingerprint({
    ...snapshot,
    candidate_id: "candidate-b",
  }));
  assert.notEqual(first, deriveMaterialProgressFingerprint({
    ...snapshot,
    evidence: { ...snapshot.evidence, overall_status: "locally-verified" },
  }));
});

test("reentrant and no-progress blockers remain sticky until deliberate reactivation", () => {
  let guards = evaluateContinuation(null, { run_id: "run-a" }, policy);
  guards = evaluateContinuation(guards, { run_id: "run-b" }, policy);
  assert.equal(guards.halt_reason, "reentrant-run");
  const sticky = evaluateContinuation(guards, { finish_run: true, progress_sha256: "changed" }, policy);
  assert.equal(sticky.halt_reason, "reentrant-run");
  assert.equal(sticky.halted, true);

  guards = evaluateContinuation(null, { progress_sha256: "same" }, policy);
  guards = evaluateContinuation(guards, { progress_sha256: "same" }, policy);
  guards = evaluateContinuation(guards, { progress_sha256: "same" }, policy);
  assert.equal(guards.halt_reason, "no-progress");
  assert.equal(evaluateContinuation(guards, { progress_sha256: "different" }, policy).halt_reason, "no-progress");
});

test("phase-aware reducer chooses implementation, verification, diagnosis, protected closure, delivery, and completion", () => {
  const task = {
    acceptance: [{ id: "AC-1", behavior: "Implement behavior one." }],
    checks: [{ id: "focused", required: true, command: "node --test", criterion_ids: ["AC-1"] }],
  };
  const missing = { overall_status: "missing", checks: [] };
  assert.equal(selectLifecycleAction({ state: state(), task, evidence: missing, blockers: [] }).kind, "implementation");
  assert.equal(selectLifecycleAction({ state: state({ phase: "verify", current_slice: null }), task, evidence: missing, blockers: [] }).kind, "verification");
  assert.equal(selectLifecycleAction({ state: state({ phase: "verify", current_slice: null }), task, evidence: { overall_status: "failed", checks: [{ id: "focused", state: "fail" }] }, blockers: [] }).kind, "diagnosis");
  assert.equal(selectLifecycleAction({ state: state({ phase: "protected-closure", current_slice: null, completion_target: "closure-verified" }), task, evidence: { overall_status: "locally-verified", checks: [{ id: "focused", state: "pass" }] }, blockers: [] }).kind, "protected-closure");
  assert.equal(selectLifecycleAction({ state: state({ phase: "deliver", current_slice: null, completion_target: "delivered-and-verified" }), task, evidence: { overall_status: "closure-verified", checks: [{ id: "focused", state: "pass" }] }, blockers: [] }).kind, "delivery");
  assert.equal(selectLifecycleAction({ state: state({ phase: "verify", current_slice: null }), task, evidence: { overall_status: "locally-verified", checks: [{ id: "focused", state: "pass" }] }, blockers: [] }).kind, "complete");
  assert.equal(selectLifecycleAction({ state: state(), task, evidence: missing, blockers: [{ code: "bead-blocked", message: "Blocked." }] }).kind, "blocker");
});
