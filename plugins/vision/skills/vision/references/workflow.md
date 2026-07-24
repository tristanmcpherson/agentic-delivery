# Workflow

## Pre-goal discovery

Resume an existing goal, contract, and Bead when they describe the same outcome. For new contracted work, perform discovery before goal creation or candidate edits.

Choose the least expensive research mode that can resolve the unknowns:

| Mode | Use when | Required record |
| --- | --- | --- |
| `direct` | One bounded question or a fully specified local change | Main-agent conclusion and evidence references; no claimed scouts |
| `scouted` | Two or more independent repository, domain, external, or verification questions | One to three completed read-only scout summaries |
| `fallback` | Scouting would be useful but subagent tools are unavailable | Capability state, reason, and equivalent direct research |

Do not scout merely because delegation exists. Scouts cost additional time and tokens. Prefer them for read-heavy exploration, current external research, architecture/data-flow tracing, test or log triage, and verification design. Keep write-heavy work out of discovery.

Give every scout a bounded question and require this return contract:

- concise conclusion;
- exact file/line, artifact, or authoritative URL references;
- confidence and unresolved uncertainty or source conflicts;
- material decisions that still require the user;
- proposed acceptance criteria, risk flags, and verification implications.

Declare the scout read-only. Forbid file, Beads, goal, configuration, and external-state writes; raw transcript/log return; recursive delegation; authority expansion; and completion claims. A scout is an advisory planner helper, not an independent verifier.

After all scouts return, the main agent must synthesize the observable outcome, requirements, constraints, non-goals, evidence-backed conclusions, reversible non-material assumptions, direct risks, acceptance/check mapping, approval boundaries, and remaining material decisions. Resolve contradictions by evidence or a recorded user decision, never majority vote. Keep `unresolved_material` empty before marking intake ready.

Freeze the schema-v3 contract, validate it, then generate the canonical goal payload:

```powershell
node .vision/bin/vision-harness.mjs validate-task --task <task>
node .vision/bin/vision-harness.mjs goal-spec --task <task> --json
```

Set `goal_spec.objective` to the exact synthesized outcome. Pass the emitted canonical `objective` unchanged to the available authorized goal mechanism; the harness adds the task ID, contract version, every acceptance ID, and requested completion state. If the surface exposes no goal capability or the invocation did not authorize it, use `contract-fallback`, retain the generated objective in the plan or Bead, and never claim a persistent goal exists.

After goal creation or reconciliation, activate the authority-neutral lifecycle cache with the emitted intent hash and Bead:

```powershell
node .vision/bin/vision-lifecycle.mjs activate --task <task> --goal-intent <sha256> --bead <id> --slice <slice-id>
```

On continuation, run `resume --json`. Reconcile contract, goal intent, Bead, workspace/worktree, branch, candidate, approvals, guards, and current evidence before acting on its single `next_slice`. The cache is rebuildable; the contract and Beads remain authoritative.

When the frozen contract declares `execution_graph`, generate its deterministic wave plan after goal reconciliation:

```powershell
node .vision/bin/vision-harness.mjs graph-plan --task <task> --json
node .vision/bin/vision-harness.mjs graph-plan --task <task> --completed node-a,node-b --json
```

Use the first command for a fresh graph. On resume, obtain completed node IDs from durable Beads state and use the second form. `graph-plan` is read-only and authority-neutral; it rejects unknown completions and a completed node whose incoming dependencies are incomplete.

## Intake output

Lead with the proposed outcome. Record research mode and capability state, stable conclusions and evidence references, inferred size, size source, confidence, risk flags, acceptance criteria, constraints, non-goals, dependencies, approval boundaries, goal specification, and open blockers. For each criterion, name the exact checks and what each can prove.

Risk flags should describe the system boundary directly, for example: `logic`, `api-contract`, `persistence`, `migration`, `async`, `ui-behavior`, `visual`, `auth`, `tenant`, `external-integration`, `runtime-config`, `deployment`, `security`, or `performance`.

New contracts use `risk_gate_version: 1`. Every direct risk must appear on at least one required check's `risk_flags`. The harness validates stage and acceptance-surface compatibility independently of planning size.

## Risk-to-gate defaults

| Risk | Minimum useful evidence |
| --- | --- |
| Logic | Focused unit/property tests plus static checks |
| API contract | Handler/service integration with real serializer/router |
| Persistence/migration | Ephemeral real database, migrations, rollback/compatibility checks |
| Async | Controlled queue/worker plus eventual server-side postcondition |
| UI behavior | Deterministic browser assertion; real first-party services when behavior depends on them |
| Visual | Final-state screenshot plus structured review bound to image hash |
| Auth/tenant | Real role/tenant boundary in a capable environment; unique account/data namespace |
| Runtime config/deployment | Deployed staging with immutable artifact/deployment identities |
| Security | Repository security adapter, negative tests, and independent review |
| Performance | Representative load/trace with explicit budget and baseline |

Migration and async adapters should emit the portable system-attestation schema when the repository lacks a richer protected evidence format. A green command without the required nonce-bound assertions is incomplete.

These are defaults, not a universal substitute for repository knowledge.

## Beads

Use Beads for durable work, dependencies, decisions, and evidence references. Serialize writes when the chosen Beads store requires it. Do not let Bead closure override a failed, stale, missing, or self-attested verifier result.

## Bounded orchestration

Use at most three scouts, at most three parallel execution nodes, no recursive delegation, at most two advisory-review retries, two consecutive unchanged progress checkpoints, three repeats of the same authorization blocker, and the configured context-pressure handoff threshold. Hooks may restore redacted context but never write state or force a turn to continue. A timed-out scout is not a completed scout.

Use project-scoped role profiles only for one bounded assignment. Builders own explicit files; gap and builder reviewers remain read-only. Their output is builder-side advice, not approval or closure evidence.

Task-owned worktrees are optional. `worktree-create` previews by default, requires the exact goal intent and a committed contract, creates only a `codex/` branch with `--apply`, and writes an authority-neutral ownership marker. Activation and resume refuse wrong-root, wrong-branch, marker-drift, or stale-candidate use. Cleanup remains explicit and outside automatic continuation.

### Execution graph topology

Use `execution_graph` only when splitting the work materially improves speed, context quality, or independent review. A small or effectively linear task should stay linear.

- Every node binds one bounded job to criterion IDs and declares `inputs`, `outputs`, `executor`, `isolation`, and `write_scope`.
- Every non-contract input is supplied by exactly one edge. The edge names and types the artifact that crosses the boundary; chronology alone is not an edge.
- The planner parallelizes only `read-only` and `worktree` nodes. A `shared` writer is always a wave of one.
- A fan-in node waits for every incoming dependency. Required failures block the fan-in and must remain visible.
- `deterministic-code` is for mechanical reduction with no workspace writes. Reviews stay read-only and builder-side advisory.
- The builder graph is acyclic. Verification failures may route through the separate bounded repair policy, which requires `dedupe_scope=all-seen` and `required_failure=block`.
- Protected verification and delivery remain outside the graph under their existing signed-controller boundaries.

## Execution loop

For linear work, one iteration advances one slice. For a declared graph, one iteration advances one ready wave and records its completed node IDs and artifact references before replanning. A wave is not one giant task: each node remains independently bounded and the primary agent waits at the next real fan-in.

In outcome mode, repeat this loop rather than returning an intermediate status to the user. `implemented-not-verified` selects verification; deterministic failed evidence selects diagnosis and a bounded fix; a corrected candidate returns to verification; a passing state below the requested target selects the next authorized phase. Ordinary in-scope failures do not require a “should I continue?” question. Stop only at the declared target or one of the skill's explicit decision, authority, blocker, cancellation, or resource limits.

1. Confirm the active goal, frozen contract version, and candidate slice agree.
2. Reproduce the failure or establish the baseline.
3. Implement the smallest coherent change.
4. Run the cheapest relevant check.
5. Run all checks required by the slice's risks.
6. Diagnose failures from artifacts; do not weaken the gate.
7. Record required advisory lanes against the exact current attempt; treat missing, stale, tampered, failed, or inconclusive review as not passed.
8. Hand the immutable candidate and exact grant request to the protected controller; keep the signing key out of candidate jobs.
9. Deliver through the repo adapter only after required evidence passes, then require a separately signed delivery-controller attestation for `delivered-and-verified`.
10. Refresh harness and lifecycle status, choose the single next slice, and repeat when still below target.
11. Complete the goal only when its declared completion target has actually been reached.
