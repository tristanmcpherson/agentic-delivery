import { createHash } from "node:crypto";

export const LIFECYCLE_PHASES = Object.freeze([
  "implement",
  "verify",
  "diagnose",
  "protected-closure",
  "deliver",
]);

export const TERMINAL_STATES = Object.freeze([
  "verified",
  "blocked",
  "failed",
  "cancelled",
  "paused",
  "budget-exhausted",
]);

const COMPLETION_RANK = new Map([
  ["implemented-not-verified", 0],
  ["locally-verified", 1],
  ["closure-verified", 2],
  ["delivered-and-verified", 3],
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function hashCanonical(value) {
  const serialized = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : JSON.stringify(stableValue(value));
  return createHash("sha256").update(serialized).digest("hex");
}

function assertRevision(state, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("expected_revision must be a non-negative integer.");
  }
  if (state.revision !== expectedRevision) {
    throw new Error(`Stale lifecycle revision ${expectedRevision}; current revision is ${state.revision}.`);
  }
}

function assertPhase(phase) {
  if (!LIFECYCLE_PHASES.includes(phase)) throw new Error(`Unsupported lifecycle phase: ${phase}.`);
}

function assertTerminal(kind) {
  if (!TERMINAL_STATES.includes(kind)) throw new Error(`Unsupported lifecycle terminal state: ${kind}.`);
}

function assertMutable(state) {
  if (state.terminal_state) throw new Error(`Lifecycle is already in terminal state ${state.terminal_state.kind}.`);
}

function activeLease(lease, nowMs) {
  return lease && Date.parse(lease.expires_at) > nowMs;
}

export function acquireLifecycleLease(state, request) {
  assertRevision(state, request.expected_revision);
  assertMutable(state);
  if (typeof request.owner !== "string" || !request.owner.trim()) throw new Error("Lease owner is required.");
  if (typeof request.token !== "string" || !request.token.trim()) throw new Error("Lease token is required.");
  if (!Number.isFinite(request.now_ms)) throw new Error("Lease time is required.");
  if (!Number.isInteger(request.ttl_ms) || request.ttl_ms < 1_000 || request.ttl_ms > 3_600_000) {
    throw new Error("Lease ttl_ms must be an integer from 1000 to 3600000.");
  }

  const current = state.lease;
  const renewing = activeLease(current, request.now_ms);
  if (renewing && current.owner !== request.owner) throw new Error(`Lifecycle is leased by ${current.owner}.`);
  if (renewing && current.token !== request.token) throw new Error("Lifecycle lease token does not match.");
  const generation = renewing ? current.generation : Number(state.lease_generation || 0) + 1;
  const acquiredAt = renewing ? current.acquired_at : new Date(request.now_ms).toISOString();
  return {
    ...state,
    revision: state.revision + 1,
    lease_generation: generation,
    lease: {
      owner: request.owner,
      token: request.token,
      generation,
      acquired_at: acquiredAt,
      heartbeat_at: new Date(request.now_ms).toISOString(),
      expires_at: new Date(request.now_ms + request.ttl_ms).toISOString(),
      ttl_ms: request.ttl_ms,
    },
  };
}

function assertLease(state, request) {
  if (!state.lease) throw new Error("Lifecycle mutation requires an active lease.");
  if (state.lease.owner !== request.lease_owner) throw new Error("Lifecycle lease owner does not match.");
  if (state.lease.token !== request.lease_token) throw new Error("Lifecycle lease token does not match.");
  if (Date.parse(state.lease.expires_at) <= request.now_ms) throw new Error("Lifecycle lease expired.");
}

export function transitionLifecycle(state, request) {
  assertRevision(state, request.expected_revision);
  assertMutable(state);
  assertLease(state, request);
  const phase = request.phase ?? state.phase;
  assertPhase(phase);
  if (request.terminal_state !== undefined && request.terminal_state !== null) assertTerminal(request.terminal_state);
  const phaseChanged = phase !== state.phase;
  const terminal = request.terminal_state
    ? {
        kind: request.terminal_state,
        reason: String(request.terminal_reason || `Lifecycle ended as ${request.terminal_state}.`),
        at: new Date(request.now_ms).toISOString(),
      }
    : null;
  const lease = request.release_lease || terminal
    ? null
    : {
        ...state.lease,
        heartbeat_at: new Date(request.now_ms).toISOString(),
        expires_at: new Date(request.now_ms + state.lease.ttl_ms).toISOString(),
      };
  return {
    ...state,
    revision: state.revision + 1,
    phase,
    phase_entered_at: phaseChanged ? new Date(request.now_ms).toISOString() : state.phase_entered_at,
    terminal_state: terminal,
    lease,
    ...(Object.hasOwn(request, "current_slice") ? { current_slice: request.current_slice } : {}),
    ...(Object.hasOwn(request, "pending_approval") ? { pending_approval: request.pending_approval } : {}),
    ...(Object.hasOwn(request, "guards") ? { guards: request.guards } : {}),
    ...(request.progress_sha256 ? { material_progress_sha256: request.progress_sha256 } : {}),
  };
}

function orderedStates(values, fields) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Object.fromEntries(fields.map((field) => [field, value?.[field] ?? null])))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function deriveMaterialProgressFingerprint(snapshot) {
  const evidence = snapshot.evidence || {};
  return hashCanonical({
    contract_hash: snapshot.contract_hash ?? null,
    candidate_id: snapshot.candidate_id ?? null,
    workspace_candidate_sha256: snapshot.workspace_candidate_sha256 ?? null,
    acceptance: orderedStates(snapshot.acceptance, ["id", "behavior_sha256"]),
    evidence: {
      content_sha256: evidence.content_sha256 ?? null,
      contract_hash: evidence.contract_hash ?? null,
      candidate_id: evidence.candidate_id ?? null,
      workspace_fingerprint: evidence.workspace_fingerprint ?? null,
      config_hash: evidence.config_hash ?? null,
      harness_hash: evidence.harness_hash ?? null,
      overall_status: evidence.overall_status ?? "missing",
      criteria: orderedStates(evidence.criteria, ["id", "status"]),
      checks: orderedStates(evidence.checks, ["id", "state"]),
    },
  });
}

export function evaluateContinuation(previous, input, policy) {
  if (previous?.halted) return { ...previous };
  const guards = {
    last_progress_sha256: previous?.last_progress_sha256 || null,
    no_progress_count: Number(previous?.no_progress_count || 0),
    authorization_failure_sha256: previous?.authorization_failure_sha256 || null,
    authorization_failure_count: Number(previous?.authorization_failure_count || 0),
    context_percent: input.context_percent ?? previous?.context_percent ?? null,
    active_run_id: previous?.active_run_id || null,
    halted: false,
    halt_reason: null,
    halt_message: null,
  };
  if (input.progress_sha256) {
    guards.no_progress_count = guards.last_progress_sha256 === input.progress_sha256 ? guards.no_progress_count + 1 : 0;
    guards.last_progress_sha256 = input.progress_sha256;
  }
  if (input.authorization_failure_sha256) {
    guards.authorization_failure_count = guards.authorization_failure_sha256 === input.authorization_failure_sha256
      ? guards.authorization_failure_count + 1
      : 1;
    guards.authorization_failure_sha256 = input.authorization_failure_sha256;
  } else if (input.clear_authorization_failure) {
    guards.authorization_failure_sha256 = null;
    guards.authorization_failure_count = 0;
  }
  if (input.finish_run) guards.active_run_id = null;
  if (input.run_id) {
    if (guards.active_run_id && guards.active_run_id !== input.run_id) {
      guards.halted = true;
      guards.halt_reason = "reentrant-run";
      guards.halt_message = `Run ${guards.active_run_id} is already active; do not start ${input.run_id}.`;
    } else guards.active_run_id = input.run_id;
  }
  if (!guards.halted && guards.context_percent !== null && guards.context_percent >= policy.max_context_percent) {
    guards.halted = true;
    guards.halt_reason = "context-pressure";
    guards.halt_message = `Context usage reached ${guards.context_percent}%; compact or hand off before continuing.`;
  }
  if (!guards.halted && guards.no_progress_count >= policy.max_no_progress_resumes) {
    guards.halted = true;
    guards.halt_reason = "no-progress";
    guards.halt_message = `No material progress was observed across ${guards.no_progress_count} continuation checkpoints.`;
  }
  if (!guards.halted && guards.authorization_failure_count >= policy.max_authorization_failures) {
    guards.halted = true;
    guards.halt_reason = "authorization-blocked";
    guards.halt_message = `The same authorization blocker repeated ${guards.authorization_failure_count} times.`;
  }
  return guards;
}

export function completionReached(target, status) {
  return COMPLETION_RANK.has(target)
    && COMPLETION_RANK.has(status)
    && COMPLETION_RANK.get(status) >= COMPLETION_RANK.get(target);
}

export function terminalForBeadStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "blocked") return "blocked";
  if (normalized === "paused") return "paused";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  return null;
}

function firstIncompleteCheck(task, evidence) {
  const states = new Map((evidence?.checks || []).map((check) => [check.id, check.state]));
  return task.checks.find((check) => check.required !== false && states.get(check.id) !== "pass") || null;
}

export function selectLifecycleAction({ state, task, evidence, blockers }) {
  if (blockers.length) return { id: `resolve-${blockers[0].code}`, kind: "blocker", phase: state.phase, action: blockers[0].message };
  if (state.terminal_state) return { id: `terminal-${state.terminal_state.kind}`, kind: "terminal", phase: state.phase, terminal_state: state.terminal_state.kind, action: state.terminal_state.reason };
  if (completionReached(state.completion_target, evidence?.overall_status)) return { id: "goal-complete", kind: "complete", phase: state.phase, terminal_state: "verified", action: `Preserve evidence and report ${evidence.overall_status}.` };
  if (evidence?.overall_status === "failed" || state.phase === "diagnose") return { id: "diagnose-failed-evidence", kind: "diagnosis", phase: "diagnose", action: "Diagnose the failed required evidence before another bounded attempt." };
  if (state.completion_target === "delivered-and-verified" && evidence?.overall_status === "closure-verified") return { id: "deliver-verified-candidate", kind: "delivery", phase: "deliver", action: "Invoke the protected delivery controller and verify the deployed identity." };
  if (["closure-verified", "delivered-and-verified"].includes(state.completion_target) && evidence?.overall_status === "locally-verified") return { id: "request-protected-closure", kind: "protected-closure", phase: "protected-closure", action: "Request protected verifier closure for the exact candidate and evidence identity." };
  if (state.phase === "deliver") return { id: "deliver-verified-candidate", kind: "delivery", phase: "deliver", action: "Invoke the protected delivery controller and verify the deployed identity." };
  if (state.phase === "protected-closure") return { id: "request-protected-closure", kind: "protected-closure", phase: "protected-closure", action: "Request protected verifier closure for the exact candidate and evidence identity." };
  if (state.phase === "implement" && state.current_slice) return { id: state.current_slice.id, kind: "implementation", phase: "implement", action: state.current_slice.summary };
  if (state.phase === "verify") {
    const check = firstIncompleteCheck(task, evidence);
    if (check) return { id: check.id, kind: "verification", phase: "verify", action: check.command, criterion_ids: check.criterion_ids };
    return { id: "refresh-status", kind: "verification", phase: "verify", action: "Rebuild current status from immutable required-check evidence." };
  }
  const criterion = task.acceptance[0];
  return { id: `implement-${criterion.id}`, kind: "implementation", phase: "implement", action: criterion.behavior, criterion_ids: [criterion.id] };
}
