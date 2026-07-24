# Vision manager control plane

`vision manager plan` is a one-shot planning surface, not a scheduler. It reads the active Vision cache, its frozen task contract, and current evidence. It can ingest a structured Codex worker-state document and produce a bounded follow-up request, but every request is preview-only.

The repository currently ships no concrete Codex task, thread, or automation API. That is reported as `codex-platform-adapter-unavailable`, and the plan remains `blocked-no-platform-adapter`. This is intentional: an environment variable, worker transcript, or local test result must not be mistaken for the ability to schedule a Codex task.

## Adapter contract

A future platform-owned adapter must declare schema version 1, `kind: codex-platform-adapter`, `authority: platform`, and `runtime_available: true`. It may expose `schedule_followup` and `inspect_worker` capabilities. The adapter owns live thread lookup, submission, retry timing, and idempotency. Vision supplies only bounded route payloads and must receive a structured worker-state back.

Worker-state uses schema version 1 and `kind: codex-worker-state`, with a worker identifier, observed timestamp, optional task identifier, and one of `active`, `stalled`, `waiting-external`, `completed`, `failed`, or `unknown`.

## Manager-owned safety sweep

For a long-running active task, Vision owns exactly one scheduled safety sweep. Its durable task-state record is `vision-manager-automation` schema version 1, authority `none`, bound to the task, with the Codex automation identifier, lifecycle status (`active`, `paused`, or `deleted`), and notification mode fixed to `failed-runs-only`.

The manager agent must use the task's registered Codex project target. Before creating a sweep it checks the ownership record: an active record is tracked, not recreated. It plans a 15-minute bounded sweep that reads lifecycle, worker state, and bound evidence, then requests only recovery or real-verification work. When the task becomes terminal, it retires the owned sweep by deleting it; inactive tasks may be paused first where platform policy requires it.

Node/plugin code cannot invoke Codex app tools. At runtime, the manager agent must detect `codex_app.automation_update`, then execute the generated tool request and persist the returned automation identifier in the ownership record. If the tool is absent, the plan reports `manager-agent-automation-tool-unavailable`; no schedule is claimed or fabricated.

## Protected handoffs

Missing, stale, incomplete, or failed evidence produces `dev-verification-required`: execute the bound real checks in the development environment and ingest fresh evidence. Locally verified work above its target routes to protected verification. Closure-verified work may create a `merge-proposal-protected` handoff, but it cannot merge.

An `approval-gated-auto-merge` plan requires a `protected-merge-approval` document issued by the protected controller and bound to the exact candidate. Even then, this manager only prepares the protected-controller request. Merge and deployment remain prohibited here.
