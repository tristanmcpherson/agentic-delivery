# Vision for Codex

Vision is an experimental, portable Codex framework for taking any engineering task from calibrated pre-goal discovery through implementation, verification, and protected delivery. Beads stores durable work state. A versioned task contract maps evidence-backed requirements and observable acceptance criteria to executable checks. The harness records what those checks actually proved.

UI/browser work is one verification surface, not the framework's scope. Logic, APIs, data, migrations, asynchronous systems, CLI, infrastructure, operations, security, performance, auth, and deployment risks select their own gates.

## How to use

The shortest reliable command is the Vision skill plus the outcome. Nothing else:

```text
$vision:vision Fix the invoice export bug.
```

Selecting the **Vision** skill chip and typing `Fix the invoice export bug` is equivalent. The invocation itself means: research first, create or reconcile the canonical goal, choose the smallest useful linear or graph execution shape, implement, verify, diagnose ordinary failures, repair, and reverify until `locally-verified` by default. You should not have to repeat that boilerplate.

For ordinary `build`, `fix`, `implement`, `continue`, or `finish` requests, Vision uses **outcome mode**: it keeps advancing bounded slices or dependency-safe execution waves until the task's declared completion target is reached or a concrete stop condition requires you.

To continue existing work, you should not need to interpret its current status yourself:

```text
$vision:vision Continue the active Vision task.
```

In outcome mode, `implemented-not-verified` is a routing state, not the answer. Vision should run the required available checks, diagnose ordinary failures, make bounded fixes, and reverify without asking whether it should continue:

```text
resume -> act on one slice -> verify -> status
               ^              |
               |-- diagnose <-| failed check
```

For genuinely decomposable M/L work, Vision can freeze an optional execution DAG after research. Independent read-only or worktree-isolated nodes fan out; typed artifacts flow across real dependencies; shared-workspace writers and integration fan-ins stay serialized. Small and effectively linear tasks skip this entirely.

The loop stops at the declared verified target, a material user decision, a required approval or credential, a stable external blocker, cancellation, or a configured retry/no-progress/budget limit. It never turns repetition into verifier authority and never silently performs an external or production action that still requires approval.

Use an explicit narrower prompt when you do not want the outcome loop:

```text
$vision:vision Report the active task's status and next action only. Do not edit or run checks.
$vision:vision Verify the current candidate only. Do not modify application code.
$vision:vision Plan this change, but do not implement it yet.
```

If a session is interrupted, invoke `$vision:vision Continue the active Vision task` in a new task. The frozen contract, Bead, and lifecycle checkpoint let it resume one bounded slice or graph wave at a time. Vision is a bounded Codex work loop, not an unattended infinite shell daemon.

When the plugin's prompt hook is trusted, an untagged high-confidence engineering outcome such as `Fix the invoice export bug` triggers one advisory question: `Use Vision to drive this end to end to locally-verified?` Saying yes tells Codex to select Vision with the original outcome. This works before the per-repository harness is installed. The hook skips explicit Vision or other-skill invocations, phase-limited requests such as planning/review/status, and explicit Vision opt-outs. It processes the prompt locally, does not log it, makes no network call, and cannot grant authority or perform work by itself.

Use `/hooks` to review/trust the hook after installation or to disable the offer globally. When the repository harness is present, disable only this offer for that repository with:

```json
{
  "orchestration": {
    "hooks": {
      "offer_vision_on_engineering_outcome": false
    }
  }
}
```

## Core workflow

```text
request → calibrate → direct research or read-only scouts → synthesize → resolve material choices
        → freeze contract → create persistent goal → build → verify → deliver
```

Invoke one skill:

```text
$vision:vision Build saved filters for the analytics dashboard.
```

For a new contracted outcome, the skill researches before editing or goal creation. It first reconciles an optional `.agentic/work-environment.md` profile so team decisions can travel between machines without becoming approval or evidence. It uses direct reconnaissance for one bounded question and one to three read-only scouts for independent, context-heavy unknowns. The main agent retains only evidence-backed conclusions, resolves material choices, freezes a schema-v3 contract, and generates a canonical goal objective. Existing goals/contracts resume without repeating discovery; trivial or phase-specific requests avoid unnecessary scout overhead.

After exact goal creation, the lifecycle controller binds that goal intent to the contract, Bead, workspace or task-owned worktree, branch, optional immutable candidate, current slice, and evidence. `resume` returns one next slice or a stable blocker. When the contract includes `execution_graph`, the read-only `graph-plan` command returns the deterministic ready wave and rejects impossible completion claims. Session/compaction hooks can restore redacted project context, but they are advisory and read-only; they do not force continuation or create authority.

The skill then selects the relevant internal phase: intake, build, verify, diagnose, or deliver. It infers `S`, `M`, or `L` for planning persistence and accepts a user override. Size never weakens verification or grants permission. Direct risk flags select checks.

Completion is reported honestly as one of:

- `implemented-not-verified`
- `locally-verified`
- `closure-verified`
- `delivered-and-verified`

Local builder evidence is intentionally not called closure-grade. Closure requires a protected verifier or CI principal consuming a frozen contract, immutable candidate, protected environment profiles, and a signed verifier grant. The grant binds the contract, workspace, config, trusted harness, profile definitions, candidate, repository, workflow, and verifier trust key. Beads mirrors that decision; it does not create it.

## Install the Codex plugin

The current Codex CLI discovers the repo marketplace through `.agents/plugins/marketplace.json`; the root `marketplace.json` remains as a compatibility manifest. From this directory:

```powershell
codex plugin marketplace add .
```

To install the public GitHub marketplace on another machine:

```powershell
codex plugin marketplace add tristanmcpherson/vision --ref main
codex plugin add vision@vision-local
```

To pull marketplace updates later:

```powershell
codex plugin marketplace upgrade vision-local
codex plugin add vision@vision-local
```

Install `vision` from the Codex plugin browser and start a new task. The plugin contains the outcome-driven `$vision:vision` skill, the read-only `$vision:harness-doctor` estate diagnostic, and an isolated, redacting, telemetry-disabled Chrome DevTools MCP configuration pinned to a known package version. Chrome DevTools is a diagnostic tool, not the acceptance authority.

To install the repo harness into a target repository, preview first:

```powershell
npm run vision -- install --target C:\path\to\repo
npm run vision -- install --target C:\path\to\repo --apply
```

The installer records SHA-256 ownership. Reinstallation updates only unmodified framework-owned files, preserves modified or unowned files, and previews every action. `uninstall --apply` removes only files that still match their installed hashes. `--force` is explicit and never used by uninstall. Tailor `.agentic/config.json`, `.agentic/work-environment.md`, task contracts, Playwright reporter/config, real commands, auth/data isolation, and the repository's protected CI/CD adapter before relying on evidence. Once edited, the work-environment profile is preserved across framework upgrades.

The plugin is enough for explicit invocation, the end-to-end skill loop, and the advisory prompt offer. Installing the repository harness adds durable contracts, lifecycle resume, evidence adapters, project roles, and repository-specific offer configuration. For maximum end-to-end value, do both.

You can ask the installed skill to perform the one-time setup instead of finding the installer command yourself:

```text
$vision:vision Set up the full Vision harness in this repository.
```

The installed project also gets one dependency-free CLI, deterministic doctor output, concise project context, and project-scoped roles for a read-only scout, bounded builder, adversarial gap reviewer, and builder-side code/security reviewer. Role files do not pin a model and cannot create goals, mutate Beads, approve, merge, deploy, or claim verifier independence. Run `node .agentic/bin/agentic.mjs harness-doctor --root . --json` for the broader skill, plugin, model, and ownership inventory; it leaves the existing project `doctor` intact and never applies its preview recommendations. See [Harness Doctor](docs/harness-doctor.md).

For Beads repositories, keep using the current Beads Codex integration and store verifier evidence IDs in the Bead. Serialize writers if your chosen Beads storage mode requires it.

The installer also provides the grant signer and protected-verifier adapter notes. The signer belongs in a controller job that never checks out or executes candidate code with the private key present.

New task templates use schema 3. Validate the discovery/goal binding and print the exact persistent-goal objective with:

```powershell
node .agentic/bin/agentic-harness.mjs validate-task --task <task-id>
node .agentic/bin/agentic-harness.mjs goal-spec --task <task-id> --json
node .agentic/bin/agentic-harness.mjs graph-plan --task <task-id> --json
node .agentic/bin/agentic-lifecycle.mjs activate --task <task-id> --goal-intent <intent-sha256> --bead <id> --slice <id>
node .agentic/bin/agentic-lifecycle.mjs resume --json
```

Run `graph-plan` only when the task contract declares `execution_graph`; linear contracts intentionally omit it.

The harness still accepts schema-2 contracts for existing work. Structural validation does not prove that an agent actually used scouts, kept them read-only, called the goal tool in order, or executed a graph wave as declared; those behaviors require model-run trace and workspace evaluation. See [Graph orchestration](docs/graph-orchestration.md) for what Vision adopted from the linked graph-engineering material and what it deliberately rejected.

## What the harness proves

Checks declare both their acceptance coverage and `claim_scope`. Mocked/unit checks can prove their seam but cannot be promoted into first-party integration evidence. A flow that depends on a first-party service needs a lane where all first-party services used by that behavior are real.

For strong browser/service provenance, the proof harness binds:

- the exact business request and allowed origin;
- an unpredictable per-run nonce;
- request, response, and protected deployment identities;
- a UI assertion derived from the real response;
- an independent backend correlation record;
- expected test IDs, skips, and retries;
- current candidate, contract, config, harness, profile, toolchain, and artifact hashes;
- Ed25519-signed protected-verifier authorization for closure evidence;
- nonce-bound system-adapter assertions for data, migrations, and asynchronous postconditions;
- structured visual review bound to exact screenshot hashes when appearance is material.
- direct risk-to-required-gate mappings whose stage and acceptance surface are checked independently of planning size;
- bounded advisory review lanes tied to the current run, criteria, surface, adversarial cases, cleanup receipts, and exact artifact hashes;
- distinct signed protected-delivery authority bound to closure status, candidate, target, deployment identity, explicit approval, and required post-deploy checks.

An environment marker remains useful diagnostics, but is not trusted alone.

## Run the proof

```powershell
npm install
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\.playwright-browsers"
npx playwright install chromium
npm test
npm run portability
npm run proof
npm run evaluate:pilot:current
```

The repository proof requires Node 24 because its non-UI fixture uses the built-in SQLite module. The installed harness itself remains dependency-free and supports Node 20 or newer.

The adversarial proof requires healthy cases to pass and seeded false-completion cases to fail. It covers resolved discovery and canonical goal generation; valid dependency-wave planning plus rejection of cyclic or authority-claiming graphs; raw-prompt goal activation, unresolved material requirements, write-capable scouts, raw scout transcripts, and goal-contract drift; missing or fast-only direct risk gates; bounded continuation; current-attempt advisory artifact hashes; distinct protected delivery bindings and rejection without closure; mock-only acceptance; a real API field mismatch; a correct health probe with a mocked business request; a missing required test; retry-only success; a copied environment marker with the wrong deployment identity; a missing migration backfill; an acknowledged async event without matching correlation or postcondition; a local verifier-mode config flip; healthy shared-real provenance; real SQLite migration/rollback evidence; a separate worker-process postcondition; and explicit approval for a simulated post-deploy smoke.

Mechanical proof intentionally stops at pending structured visual review. Open the exact current images, then record reviewer identity, authority, confidence, observed state, anomalies, notes, and image hash with `visual-review`. A builder-agent review can support `locally-verified`; protected verifier mode still requires an independent agent or human.

This fixture is a proof of critical mechanisms, not a claim that the framework has passed the full cross-repository rollout evaluation. See [evaluation-plan.md](docs/evaluation-plan.md).

For the paired real-goal smoke, ten-hour active-time campaign, interruption controls, accounting rules, and personal test commands, see [campaign.md](docs/campaign.md).

## CI and protected verification

`.github/workflows/ci.yml` runs unit tests, installer portability, the browser-backed proof, and the pilot evaluator on Windows, Linux, and macOS. `.github/workflows/protected-verifier.yml` is a reference three-job controller: a trusted harness prepares the request, a protected environment signs it without candidate code or dependencies present, and a separate verifier job executes the immutable candidate without the private key.

Before accepting that workflow as closure authority, configure the `agentic-closure` environment with required reviewers, prevent self-review, restrict deployment branches, disable bypass where supported, store `AGENTIC_VERIFIER_PRIVATE_KEY` only as an environment secret, and publish only the matching `AGENTIC_VERIFIER_PUBLIC_KEY` variable. A real delivery controller must use a separate key and protected environment; the included delivery signer and harness binding do not provision that authority. See [protected-verifier.md](docs/protected-verifier.md).

## Design basis

The design uses lean, outcome-first skill guidance and executable repo feedback in line with OpenAI's [goal-mode guidance](https://learn.chatgpt.com/docs/long-running-work), [subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents), [GPT-5.6 prompting guidance](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6), [Codex best practices](https://learn.chatgpt.com/docs/codex/best-practices), and [Harness Engineering](https://openai.com/index/harness-engineering/). Portable role profiles inherit the repository or model reasoning baseline; the evaluation plan owns model-specific prompt, tool-routing, and reasoning changes instead of hard-coding them. Optional graph orchestration is documented in [Graph orchestration](docs/graph-orchestration.md). Browser gates follow Playwright's [best practices](https://playwright.dev/docs/best-practices), [API testing](https://playwright.dev/docs/api-testing), [auth isolation](https://playwright.dev/docs/auth), and [CI provisioning](https://playwright.dev/docs/ci). Runtime diagnosis uses the official [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp). Stagehand remains optional exploration and is not a completion gate.

Read [verification-model.md](docs/verification-model.md), [protected-verifier.md](docs/protected-verifier.md), [proof.md](docs/proof.md), [campaign.md](docs/campaign.md), [lazycodex-adoption.md](docs/lazycodex-adoption.md), and [sol-pro-review.md](docs/sol-pro-review.md) for the design decisions and limits.
