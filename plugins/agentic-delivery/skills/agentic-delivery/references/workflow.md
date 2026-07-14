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
node .agentic/bin/agentic-harness.mjs validate-task --task <task>
node .agentic/bin/agentic-harness.mjs goal-spec --task <task> --json
```

Set `goal_spec.objective` to the exact synthesized outcome. Pass the emitted canonical `objective` unchanged to the available authorized goal mechanism; the harness adds the task ID, contract version, every acceptance ID, and requested completion state. If the surface exposes no goal capability or the invocation did not authorize it, use `contract-fallback`, retain the generated objective in the plan or Bead, and never claim a persistent goal exists.

## Intake output

Lead with the proposed outcome. Record research mode and capability state, stable conclusions and evidence references, inferred size, size source, confidence, risk flags, acceptance criteria, constraints, non-goals, dependencies, approval boundaries, goal specification, and open blockers. For each criterion, name the exact checks and what each can prove.

Risk flags should describe the system boundary directly, for example: `logic`, `api-contract`, `persistence`, `migration`, `async`, `ui-behavior`, `visual`, `auth`, `tenant`, `external-integration`, `runtime-config`, `deployment`, `security`, or `performance`.

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

## Execution loop

1. Confirm the active goal, frozen contract version, and candidate slice agree.
2. Reproduce the failure or establish the baseline.
3. Implement the smallest coherent change.
4. Run the cheapest relevant check.
5. Run all checks required by the slice's risks.
6. Diagnose failures from artifacts; do not weaken the gate.
7. Hand the immutable candidate and exact grant request to the protected controller; keep the signing key out of candidate jobs.
8. Deliver through the repo adapter only after required evidence passes.
9. Complete the goal only when its declared completion target has actually been reached.
