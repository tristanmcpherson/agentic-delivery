# Task contract

The contract is small, versioned, and many-to-many. Use `assets/task-contract.example.json` as a starting point. Create new contracts with schema 3; the harness continues to accept schema 2 so existing work can be resumed without rewriting its evidence identity.

Schema 3 adds two required orchestration records and one optional execution record:

- `intake` stores stable research conclusions, evidence references, capability state, bounded read-only scout summaries, resolved conflicts, reversible non-material assumptions, and the synthesized requirements/risk/acceptance set. It must be `ready` with no unresolved material decision before checks or verifier grants can run.
- `goal_spec` stores the exact synthesized outcome, complete acceptance-ID set, honest completion target, persistence mode, and available goal mechanism. `goal_spec.objective` must equal `intake.synthesis.outcome`; the harness adds task/version/acceptance metadata. Generate the exact tool objective with `agentic-harness goal-spec`; do not manually paraphrase it after the contract is frozen.
- `execution_graph` is optional. Use it only for naturally decomposable work. It stores an acyclic, acceptance-linked builder graph with a maximum parallel width, bounded node contracts, artifact-carrying edges, isolation/write scope, and a strict convergence policy. It is part of the frozen contract hash, but it is never verifier or approval authority.

Store summaries, not scout transcripts or raw logs. These fields are self-reported orchestration state: structural validation cannot prove that a model actually delegated, stayed read-only, or called a goal tool in the claimed order. Evaluate those behaviors from model traces and before/after workspace state.

An execution-graph node declares `id`, `kind`, `executor`, `description`, `criterion_ids`, `inputs`, `outputs`, `isolation`, and `write_scope`. Contract inputs use the `contract:` prefix. Every other input must be supplied by exactly one edge whose named artifact is declared by both the producer and consumer. Each edge also declares a lowercase kebab-case `artifact_type`; one producer artifact cannot change type across consumers. Supported executors are the primary agent, bounded builder, two builder-side reviewers, and deterministic code. Protected verifier/delivery roles are intentionally invalid.

The convergence policy is deliberately stricter than a generic fan-out helper: `required_failure` is `block`, `dedupe_scope` is `all-seen`, repair rounds are capped, and no-progress is bounded. A missing worker cannot be dropped just because other nodes returned successfully. `graph-plan` emits deterministic waves, parallelizes only read-only or worktree-isolated nodes, and serializes shared-workspace writers.

Each check declares:

- `criterion_ids`: claims it supports;
- `claim_scope`: what passing actually proves;
- `stage`: fast, integration, UI, or post-deploy;
- `profile`: environment capabilities when applicable;
- `required`: whether closure depends on it;
- `risk_flags`: the direct task risks this required gate covers when `risk_gate_version` is `1`;
- `artifacts`: browser attestation, test-integrity, screenshot, visual-review, business provenance, and system-attestation requirements.

With `risk_gate_version: 1`, every task risk must be mapped by a required check. The mapping must use a compatible acceptance surface and stage: logic may use fast or integration, UI/visual risks require UI or post-deploy, and service/security/runtime/deployment risks require integration or stronger. S/M/L never changes this validation.

For `persistence`, `migration`, or `async` risk, use `artifacts.system_attestation` with a `kind` and exact `required_assertions`. The adapter output must bind its task/check, run nonce and correlation, typed subject, operation hashes, and each required assertion's evidence hash.

When structured builder-side review is material, use `artifacts.advisory_reviews` with `required_lanes`, named `required_adversarial_cases`, named `required_cleanup_receipts`, and a bounded `max_retries`. Each review input must exactly cover the check criteria, select a compatible surface, and name current-attempt artifact paths. The harness stores recomputed hashes plus task, contract, run, check, candidate, workspace, config, and harness bindings. `inconclusive` is a failing advisory verdict, not approval.

Task size controls plan persistence only. Risk flags select gates. Approval is determined by the action, target, credentials, and side effects.

A material contract change increments `contract_version`, records the amendment reason, and invalidates evidence issued for prior versions.
If the change alters the observable intent, acceptance set, or requested completion target, pause and reconcile the persistent goal instead of allowing it to diverge from the amended contract.

`.vision/state/active-task.json` and task-owned worktree markers are derived context caches and are intentionally outside the task contract's authority. Never use them to amend requirements, approve actions, or promote evidence.
