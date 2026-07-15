# Vision for Codex

Vision is an experimental, portable Codex framework for taking any engineering task from calibrated pre-goal discovery through implementation, verification, and protected delivery. Beads stores durable work state. A versioned task contract maps evidence-backed requirements and observable acceptance criteria to executable checks. The harness records what those checks actually proved.

UI/browser work is one verification surface, not the framework's scope. Logic, APIs, data, migrations, asynchronous systems, CLI, infrastructure, operations, security, performance, auth, and deployment risks select their own gates.

## Core workflow

```text
request → calibrate → direct research or read-only scouts → synthesize → resolve material choices
        → freeze contract → create persistent goal → build → verify → deliver
```

Invoke one skill:

```text
$vision Build saved filters for the analytics dashboard.
```

For a new contracted outcome, the skill researches before editing or goal creation. It first reconciles an optional `.agentic/work-environment.md` profile so team decisions can travel between machines without becoming approval or evidence. It uses direct reconnaissance for one bounded question and one to three read-only scouts for independent, context-heavy unknowns. The main agent retains only evidence-backed conclusions, resolves material choices, freezes a schema-v3 contract, and generates a canonical goal objective. Existing goals/contracts resume without repeating discovery; trivial or phase-specific requests avoid unnecessary scout overhead.

After exact goal creation, the lifecycle controller binds that goal intent to the contract, Bead, workspace or task-owned worktree, branch, optional immutable candidate, current slice, and evidence. `resume` returns one next slice or a stable blocker. Session/compaction hooks can restore redacted project context, but they are advisory and read-only; they do not force continuation or create authority.

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

Install `vision` from the Codex plugin browser and start a new task. The plugin contains one skill and an isolated, redacting, telemetry-disabled Chrome DevTools MCP configuration pinned to a known package version. Chrome DevTools is a diagnostic tool, not the acceptance authority.

To install the repo harness into a target repository, preview first:

```powershell
npm run vision -- install --target C:\path\to\repo
npm run vision -- install --target C:\path\to\repo --apply
```

The installer records SHA-256 ownership. Reinstallation updates only unmodified framework-owned files, preserves modified or unowned files, and previews every action. `uninstall --apply` removes only files that still match their installed hashes. `--force` is explicit and never used by uninstall. Tailor `.agentic/config.json`, `.agentic/work-environment.md`, task contracts, Playwright reporter/config, real commands, auth/data isolation, and the repository's protected CI/CD adapter before relying on evidence. Once edited, the work-environment profile is preserved across framework upgrades.

The installed project also gets one dependency-free CLI, deterministic doctor output, concise project context, and project-scoped roles for a read-only scout, bounded builder, adversarial gap reviewer, and builder-side code/security reviewer. Role files do not pin a model and cannot create goals, mutate Beads, approve, merge, deploy, or claim verifier independence.

For Beads repositories, keep using the current Beads Codex integration and store verifier evidence IDs in the Bead. Serialize writers if your chosen Beads storage mode requires it.

The installer also provides the grant signer and protected-verifier adapter notes. The signer belongs in a controller job that never checks out or executes candidate code with the private key present.

New task templates use schema 3. Validate the discovery/goal binding and print the exact persistent-goal objective with:

```powershell
node .agentic/bin/agentic-harness.mjs validate-task --task <task-id>
node .agentic/bin/agentic-harness.mjs goal-spec --task <task-id> --json
node .agentic/bin/agentic-lifecycle.mjs activate --task <task-id> --goal-intent <intent-sha256> --bead <id> --slice <id>
node .agentic/bin/agentic-lifecycle.mjs resume --json
```

The harness still accepts schema-2 contracts for existing work. Structural validation does not prove that an agent actually used scouts, kept them read-only, or called the goal tool in order; those behaviors require model-run trace and workspace evaluation.

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

The adversarial proof requires healthy cases to pass and seeded false-completion cases to fail. It covers resolved discovery and canonical goal generation; raw-prompt goal activation, unresolved material requirements, write-capable scouts, raw scout transcripts, and goal-contract drift; missing or fast-only direct risk gates; bounded continuation; current-attempt advisory artifact hashes; distinct protected delivery bindings and rejection without closure; mock-only acceptance; a real API field mismatch; a correct health probe with a mocked business request; a missing required test; retry-only success; a copied environment marker with the wrong deployment identity; a missing migration backfill; an acknowledged async event without matching correlation or postcondition; a local verifier-mode config flip; healthy shared-real provenance; real SQLite migration/rollback evidence; a separate worker-process postcondition; and explicit approval for a simulated post-deploy smoke.

Mechanical proof intentionally stops at pending structured visual review. Open the exact current images, then record reviewer identity, authority, confidence, observed state, anomalies, notes, and image hash with `visual-review`. A builder-agent review can support `locally-verified`; protected verifier mode still requires an independent agent or human.

This fixture is a proof of critical mechanisms, not a claim that the framework has passed the full cross-repository rollout evaluation. See [evaluation-plan.md](docs/evaluation-plan.md).

## CI and protected verification

`.github/workflows/ci.yml` runs unit tests, installer portability, the browser-backed proof, and the pilot evaluator on Windows, Linux, and macOS. `.github/workflows/protected-verifier.yml` is a reference three-job controller: a trusted harness prepares the request, a protected environment signs it without candidate code or dependencies present, and a separate verifier job executes the immutable candidate without the private key.

Before accepting that workflow as closure authority, configure the `agentic-closure` environment with required reviewers, prevent self-review, restrict deployment branches, disable bypass where supported, store `AGENTIC_VERIFIER_PRIVATE_KEY` only as an environment secret, and publish only the matching `AGENTIC_VERIFIER_PUBLIC_KEY` variable. A real delivery controller must use a separate key and protected environment; the included delivery signer and harness binding do not provision that authority. See [protected-verifier.md](docs/protected-verifier.md).

## Design basis

The design uses lean, outcome-first skill guidance and executable repo feedback in line with OpenAI's [goal-mode guidance](https://learn.chatgpt.com/docs/long-running-work), [subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents), [GPT-5.6 prompting guidance](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6), [Codex best practices](https://learn.chatgpt.com/docs/codex/best-practices), and [Harness Engineering](https://openai.com/index/harness-engineering/). Browser gates follow Playwright's [best practices](https://playwright.dev/docs/best-practices), [API testing](https://playwright.dev/docs/api-testing), [auth isolation](https://playwright.dev/docs/auth), and [CI provisioning](https://playwright.dev/docs/ci). Runtime diagnosis uses the official [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp). Stagehand remains optional exploration and is not a completion gate.

Read [verification-model.md](docs/verification-model.md), [protected-verifier.md](docs/protected-verifier.md), [proof.md](docs/proof.md), [lazycodex-adoption.md](docs/lazycodex-adoption.md), and [sol-pro-review.md](docs/sol-pro-review.md) for the design decisions and limits.
