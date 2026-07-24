# Graph orchestration

Research snapshot: 2026-07-22.

The [linked Movez post](https://x.com/0xMovez/status/2079985963862786352) combines two things: Lance Martin's 20-minute Anthropic talk, [Claude for long-horizon tasks](https://aie-wf.sentry.dev/talks/aiewf-25-claude-for-long-horizon-tasks), and a quoted [14-step graph-engineering article](https://x.com/0xCodez/status/2079165300625330317). The headline claim that prompting disappears is marketing. The useful engineering idea is narrower: long-running agent work should be shaped by real data dependencies, explicit contracts, isolation, verifier gates, and bounded feedback loops.

Vision now adopts that idea as an optional contract-bound execution DAG. This is not a universal multi-agent engine and it is not enabled merely because a task has several steps.

## What changed

For a naturally decomposable task, schema-3 contracts may add `execution_graph`:

- nodes are bounded jobs linked to acceptance criteria;
- each node declares executor, typed input/output names, isolation, and write scope;
- edges exist only when a named, explicitly typed artifact moves from producer to consumer;
- `graph-plan` emits deterministic execution waves;
- read-only and worktree-isolated nodes may run in parallel, capped at three;
- shared-workspace writers are always serialized;
- fan-in waits for all required dependencies;
- repair rounds and no-progress are bounded, with dedupe against everything already seen;
- required worker failures block downstream work instead of being silently discarded.

Run:

```powershell
node .agentic/bin/agentic-harness.mjs validate-task --task <task>
node .agentic/bin/agentic-harness.mjs graph-plan --task <task> --json
node .agentic/bin/agentic-harness.mjs graph-plan --task <task> --completed node-a,node-b --json
```

The graph is frozen before implementation and is part of the task-contract hash. Completed nodes and artifact references live in Beads. The planner itself is read-only derived guidance, not durable state or evidence authority.

## What we deliberately did not copy

| Claim or pattern | Vision decision |
| --- | --- |
| Graph every multi-step task | No. Small and effectively linear tasks keep the single-slice loop. |
| Drop failed workers and continue with non-null results | Not for required engineering work. A required failure blocks its dependents. |
| Let agents combine mechanically | Use deterministic code for flattening, filtering, joins, dedupe, and schema validation. |
| Parallelize writers in one checkout | No. Shared-workspace writers are serial; parallel writers require isolated worktrees. |
| A reviewer subagent is independent verification | No. Graph reviewers remain builder-side advisory. Protected CI/verifier and delivery-controller boundaries do not move. |
| Let the graph change itself indefinitely | No. Repair is bounded self-correction against frozen acceptance, not autonomous persistent self-modification. |
| Hard-code a cheaper model per role | No portable pin. Runtime may route bounded read-heavy nodes to a faster model, but model settings stay evaluation-driven. |

## Why this fits Codex

OpenAI's current [subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents) says Codex can delegate independent work from skill instructions, that parallel workers reduce main-context pollution, and that parallel write-heavy work needs more care. Vision turns those recommendations into a validated task artifact rather than relying on the main agent to remember an informal plan.

This improves orchestration, latency, and context control. It does not prove the resulting software is correct. Risk-selected checks, nonce/provenance bindings, protected verification, and delivery attestations remain the actual evidence path.
