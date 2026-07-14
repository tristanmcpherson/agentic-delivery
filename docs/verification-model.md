# Verification model

## Discovery and goals are orchestration

For new contracted work, Agentic Delivery performs evidence-backed discovery before candidate edits and persistent-goal creation. Direct research handles one bounded question; one to three read-only scouts may handle independent, context-heavy questions. The main agent resolves contradictions and material choices, freezes a schema-v3 task contract, and uses its canonical `goal_spec` as the persistent objective.

The harness can reject structurally incomplete intake, unresolved material questions, declared write-capable scouts, raw transcript fields, false capability fallbacks, synthesis drift, and goal/acceptance mismatch. It cannot prove from self-reported JSON that delegation occurred, that a scout made no write, or that a goal tool was invoked after synthesis. Those claims require model trace inspection and before/after workspace auditing in the held-out evaluation.

Scouts and persistent goals remain builder-side orchestration. They are not verifier principals, do not grant approval, and do not change the evidence required for an honest completion state.

## Planning size is not risk

`S`, `M`, and `L` control only where the plan lives and how it is decomposed. The agent infers size and the user can override it. Risk flags independently select verification. Approval is determined by the action, target environment, credential scope, cost, and side effects.

Typical risk flags include `logic`, `api-contract`, `persistence`, `migration`, `async`, `ui-behavior`, `visual`, `auth`, `tenant`, `external-integration`, `runtime-config`, `deployment`, `security`, and `performance`.

## Environment and claim matrix

| Tier | Boundary | First-party requirement | Permitted claim |
| --- | --- | --- | --- |
| T0 | Unit/component | Code/component under test | Logic/component behavior only |
| T1 | Service integration | Router/handler/schema/migrations and isolated datastore | Service-boundary compatibility |
| T2 | Local full stack | Every first-party service touched by the flow | Candidate full-stack compatibility |
| T3 | Shared real | Shared first-party service, routing, config, auth/tenant as required | Compatibility with that deployment |
| T4 | Deployed staging | Release artifacts, topology, migrations, auth, runtime config, deployment IDs | Release-candidate post-deploy compatibility |
| T5 | Production smoke | Real production routing/services; safe synthetic or idempotent behavior | Narrow rollout confirmation only |

Mocked execution is a test mode, not a release environment. Mock first-party seams at T0 when useful. At T2 and above, a provenance-bearing check forbids first-party route fulfilment, HAR replay, response patching, and stale cached business responses.

## Acceptance coverage

Coverage is many-to-many. One criterion may require unit, integration, and deployed checks; one check may support several criteria. Every check declares a `claim_scope` so a green command cannot imply more than it exercised.

Material visual criteria require final-state screenshot evidence and structured review. Functional UI/API criteria require DOM, network, and server assertions even when no visual review is necessary.

## Trust boundary

- The builder proposes the contract and changes candidate code and task-specific tests.
- The verifier consumes a frozen contract, immutable candidate, protected profiles, and scoped credentials.
- The delivery controller invokes protected CI/CD, records deployment identities, and mirrors the verifier decision into Beads.

A different conversation is not independence. Closure-grade separation comes from permissions, credentials, protected inputs, and immutable artifact controls.

Setting a config field does not create a verifier. In verifier mode, every current required check must carry a valid Ed25519 grant signed by the protected controller. The grant binds the exact task, candidate, workspace, config, harness, profiles, runtime, repository, workflow, verifier, and trust-key fingerprint. The private key must never enter a job that executes candidate code.

## Evidence identity and freshness

Evidence is bound to the contract version/hash, complete candidate fingerprint, config and harness hashes, protected profile hash, runtime/toolchain identity, test IDs/results, raw artifact hashes, and deployment identity where applicable. Code, contract, profile, harness, runtime configuration, or deployment changes expire affected evidence.

Local mode issues `locally-verified`; protected verifier mode issues `closure-verified` only for signed, current verifier runs. The status builder rejects stale config, harness, profile-definition, runtime, workspace, and contract identities rather than merely recording those hashes. Missing evidence yields `implemented-not-verified`. Delivery plus matching post-deploy evidence yields `delivered-and-verified` at the workflow layer.

## Business-flow provenance

A correct health probe or environment header does not prove the acceptance interaction reached the intended API. Strong provenance records the exact business request, per-run nonce, request ID, response hash, deployment ID, UI dependence on a unique server result, and a separately queried backend correlation or postcondition. Apps that cannot expose those signals must state the weaker claim they can support.

## Test integrity and visual review

Required browser checks record collected test IDs and outcomes. Zero tests, missing expected tests, skips, focus (via Playwright `forbidOnly`), or retry-only success prevent clean verification.

Visual review stores reviewer identity/authority, confidence, observed state, anomalies, notes, and the current screenshot SHA-256. The harness recomputes the hash before accepting review. Critical visual changes should remain human-approved until an independent automated reviewer has passed the challenge-image evaluation.

## Non-UI system attestations

Data, migration, and asynchronous checks can require a system-attestation adapter. The harness supplies a per-check output path and unpredictable run nonce, then verifies the adapter kind, task/check IDs, nonce/correlation hashes, typed subject identity, operation input/output hashes, required assertion IDs, pass states, and assertion evidence hashes.

The proof uses an ephemeral real SQLite database to apply/backfill/inspect/roll back a migration and a separate worker process to consume a file-backed queue event and expose an eventual projection. These are portable protocol examples; repository adapters must replace them with the application's real database, queue, worker, observability, and cleanup controls.
