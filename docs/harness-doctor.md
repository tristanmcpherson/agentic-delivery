# Harness Doctor

Harness Doctor is Vision's read-only estate diagnostic. It complements the existing `agentic-harness.mjs doctor`, which validates one installed project harness. Harness Doctor inventories broader repository and user-level state without installing, enabling, disabling, editing, or deleting anything.

One normal `$vision` outcome prompt can drive authorized local research, implementation, tests, diagnosis, and re-verification through a locally verified result. It still stops before user installation or configuration mutation, deletion, publication, protected-verifier closure, credentialed live model evaluation, or any other authority the task did not grant. `$harness-doctor` itself stops at evidence and preview recommendations.

## Users and invocation

Repository maintainers can audit source and `.agentic` ownership:

```powershell
node plugins/vision/scripts/agentic.mjs harness-doctor --root . --scope project --json
```

Codex users can add their user environment or inspect only it:

```powershell
node plugins/vision/scripts/agentic.mjs harness-doctor --root . --codex-home $env:CODEX_HOME --scope all --json
node plugins/vision/scripts/agentic.mjs harness-doctor --codex-home $env:CODEX_HOME --scope user
```

Installed Vision projects expose the same command at `.agentic/bin/agentic.mjs`. Scope defaults to `project`. JSON is the versioned contract; human output is derived from the same report.

## Deterministic evidence

The command records:

- project, user, sibling `.agents`, plugin-provided, enabled, disabled, malformed, symlinked, operational, and historical skill state;
- source plugin manifests, installed cache payloads, configured enablement, marketplace catalogs, and declared skill, MCP, or app components;
- `.agentic` surfaces, task contracts, install-manifest ownership, current hashes, modified files, missing files, and unsafe paths;
- model and reasoning references with operational versus historical context and configured-default versus role/reference use;
- whether the Codex CLI could be queried, reporting unavailable evidence as `unknown` rather than failure.

Records and finding identifiers are deterministically sorted and contain no timestamp. The versioned contract is published at `plugins/vision/references/harness-doctor-report.schema.json`. `fail` is reserved for an integrity violation such as a manifest path escape. Advisory findings leave the process successful so the skill can add semantic review. Invalid command usage exits separately.

## Semantic review

The `$harness-doctor` skill interprets prompt clarity, overlap, redundancy, and model-role fit after inventory. It should verify current GPT-5.6 guidance from official OpenAI documentation when that documentation is available. Sol, Terra, Luna, and reasoning-level recommendations are role hypotheses that require representative evaluation; they are not global search-and-replace rules.

Every pruning recommendation remains a preview. Modified, external, symlinked, historically referenced, and ambiguously owned artifacts default to retain or manual review. Removal requires proven ownership, proven redundancy, no remaining reference, and separate explicit mutation approval.

## Limitations

The deterministic scanner intentionally uses a small known-field TOML reader rather than executing configuration. It does not resolve every possible transitive plugin loader, infer intent from prose, query remote marketplaces, or prove runtime behavior. Marketplace availability is not installation, source presence is not enablement, and an expected materialized absolute path is not drift when it exists.

Reports intentionally contain absolute local paths as provenance, so review them before sharing outside the machine. URL credentials, query strings, and fragments are redacted; MCP environment values and arbitrary file contents are not emitted.
