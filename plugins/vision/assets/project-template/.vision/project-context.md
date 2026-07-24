# Vision project context

This repository uses a research-first, contract-bound delivery workflow.

- Read `.agentic/work-environment.md` before new intake. Reuse owner decisions, research unresolved entries on a capable machine, verify discoverable facts, and never treat the profile as approval or evidence.
- Resolve material ambiguity with direct reconnaissance or bounded read-only scouts before goal creation.
- Validate the schema-v3 task contract, emit its canonical goal specification, and create or reconcile that exact goal intent.
- Use Beads for durable work state. `.agentic/state/active-task.json` is a rebuildable context cache and has no authority.
- Implement one bounded slice at a time. Scouts do not write or recurse; custom reviewers are advisory builder-side lanes.
- Select verification from direct risk flags, not planning size. Missing, stale, skipped, focused-only, retry-only, or inconclusive required evidence does not pass.
- Builder evidence can reach locally-verified. Only protected verifier evidence can authorize closure, and delivery also requires exact target, candidate, deployment, approval, and post-deploy bindings.
- Never let hooks or agents approve, merge, push, release, deploy, mutate global Codex configuration, or transmit telemetry.

Useful commands:

```text
node .agentic/bin/agentic-harness.mjs validate-task --task <id-or-path>
node .agentic/bin/agentic-harness.mjs goal-spec --task <id-or-path> --json
node .agentic/bin/agentic-lifecycle.mjs activate --task <id-or-path> --goal-intent <sha256> --bead <id>
node .agentic/bin/agentic-lifecycle.mjs resume --json
node .agentic/bin/agentic-harness.mjs doctor --json
```
