---
name: harness-doctor
description: Audit a repository, Codex home, or both for skill, plugin, marketplace, Vision harness, prompt-contract, tool, and model-setting health. Use when users ask to inspect, diagnose, rationalize, or prune-preview an agent harness or skill estate, distinguish installed from merely available components, assess GPT-5.6 role fit, or produce a read-only harness health report. Do not use for applying configuration changes or replacing the existing project doctor.
---

# Harness Doctor

Run the deterministic inventory before making semantic judgments:

```powershell
node .agentic/bin/agentic.mjs harness-doctor --root . --scope project --json
```

From a Vision source checkout, use `node plugins/vision/scripts/agentic.mjs harness-doctor ...`. Add `--codex-home <path> --scope user` for user state or `--scope all` for both. Use human output only as a view of the same JSON report.

## Interpret the report

1. Preserve the distinction between repository source, installed plugin cache, configured/enabled state, marketplace availability, historical fixtures, and materialized absolute paths.
2. Treat `fail` as an integrity problem, `attention` as evidence requiring judgment, and `unknown` as unavailable evidence rather than a defect.
3. Review malformed metadata, divergent duplicate-name candidates, ownership drift, missing declared components, model pins, and reasoning settings against their recorded paths and contexts. Treat prompt-contract signals and repeated lines as semantic-review inputs, not regex-proven defects.
4. Keep modified, external, symlinked, historically referenced, or ambiguously owned artifacts by default. Never infer deletion authority from similarity alone.

## Add current semantic guidance

Use the OpenAI developer documentation MCP when available to confirm current model and reasoning guidance. Prefer official pages such as `https://developers.openai.com/api/docs/models` and `https://developers.openai.com/codex/models` over memory. Clearly label live documentation facts separately from deterministic local inventory.

Map roles rather than rewriting every model reference:

- Consider GPT-5.6 Sol for the hardest quality-first implementation, architecture, or adversarial review roles when representative evaluation supports the cost and latency.
- Consider GPT-5.6 Terra for balanced everyday agentic coding and coordination.
- Consider GPT-5.6 Luna for latency-sensitive discovery, bounded QA, or pattern-following work where evaluation shows adequate quality.
- Treat `max` or `ultra` reasoning and per-role model pins as hypotheses to benchmark, not universal upgrades.

Assess outcome clarity, success conditions, evidence, permission boundaries, and stop conditions semantically. The scanner records signals; it does not claim to understand prompt intent.

## Return recommendations safely

Present facts first, semantic interpretation second, and a preview-only action table last. For each proposed retain, update, consolidate, disable, or remove action, state confidence, ownership, modification state, evidence, rationale, and required confirmation. Recommend removal only when ownership and redundancy are proven and no operational or historical reference remains.

Do not write files, install or enable plugins, edit Codex configuration, delete skills, or invoke an apply flag. If the user asks to make changes, stop after the preview and request explicit approval for a separate mutation task.

State that this capability complements rather than replaces `agentic-harness.mjs doctor`, which checks installed project harness health.
