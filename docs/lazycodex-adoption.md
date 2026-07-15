# LazyCodex idea adoption

This iteration reviewed LazyCodex as a product and orchestration reference, not as a trust authority or source bundle. The goal was to adopt every idea that improves operator experience or defect detection without weakening Vision's frozen-contract, explicit-approval, evidence-provenance, or protected-principal boundaries.

Research snapshot: 2026-07-14. Primary reference: [code-yeongyu/lazycodex](https://github.com/code-yeongyu/lazycodex). Current Codex extension behavior was checked against the official plugin, hook, subagent, worktree, goal-mode, and long-running-work documentation.

## Adopted directly

| LazyCodex strength | Vision implementation |
| --- | --- |
| Rich planning and exploration | Calibrated direct research or one to three read-only scouts, followed by main-agent synthesis |
| Persistent continuation | Exact post-research goal plus deterministic lifecycle `activate`, `resume`, `checkpoint`, and context recovery |
| Specialized roles | Project-scoped scout, bounded builder, gap reviewer, and builder reviewer profiles |
| Hook-assisted context | Plugin SessionStart, PostCompact, SubagentStart, and Stop hooks that are redacting, zero-egress, read-only, and advisory |
| Progress and stall handling | No-progress, repeated-authorization, reentrancy, retry, fanout, recursion, and context-pressure limits |
| Parallel quality lanes | Structured multi-lane advisory reviews tied to criteria, surfaces, current-attempt artifacts, adversarial cases, and cleanup receipts |
| Current-attempt artifacts | Run-specific evidence plus exact artifact hashes; stale or tampered review fails |
| Worktree isolation | Preview-first task-owned `codex/` worktrees with task/contract/goal/root/branch/base ownership binding |
| Installer and doctor UX | One CLI, preview/apply modes, SHA-256 ownership, safe updates, modified-file preservation, conservative uninstall, and JSON doctor output |
| Role-specific effort | Reasoning-effort hints without model-slug pinning |

## Translated to preserve trust

- Continuation files are rebuildable cache; Beads and the frozen contract remain durable authority.
- Hooks restore context but cannot force a turn to continue or mutate goals, Beads, evidence, Git, deployment, or global Codex configuration.
- Agent reviewers are builder-side advisory lanes. A different agent, model, or chat is not verifier independence.
- Quality gates require semantic contract, risk, criterion, surface, attempt, and artifact bindings rather than role names or non-empty files.
- Review retries are bounded; inconclusive is failure, and required tests still reject retry-only success.
- Git/worktree support is opt-in and candidate-bound. Merge, push, release, cleanup, and deployment remain explicit actions.
- Delivery state requires a second protected controller with a distinct Ed25519 key, current protected closure, exact candidate/target/deployment/approval, and protected post-deploy checks.

## Deliberately rejected

- Creating a persistent goal directly from the raw prompt before research and contract synthesis.
- Treating role names, reviewer prose, a second chat, or non-empty artifact files as closure authority.
- Merge-by-default, automatic push/release/deployment, or implicit destructive worktree cleanup.
- Session-start mutation of global user configuration, automatic model routing changes, package provisioning, or self-update.
- Default telemetry or any hook network egress.
- A second durable task authority competing with Beads and the task contract.
- Fanout designed for dozens of recursive agents; the portable default remains at most three non-recursive scouts.

## Honest scope

The local tests and proof exercise these mechanics on the current Windows workspace. They do not establish protected CI separation, real delivery-controller provisioning, the 24-task held-out evaluation, the 300-run adversarial suite, or macOS/Linux runtime success. Those remain explicit evaluation work.
