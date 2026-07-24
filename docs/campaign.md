# Local real-goal campaign

The campaign runner tests whether Vision helps Codex solve real repository goals under matched conditions. It is a tuning instrument, not protected verification, a held-out benchmark, or proof that Vision is better in general.

## What is frozen

`evaluation/campaign/manifest.local.json` freezes:

- four goal families: contained logic/CLI, cross-file data/async, UI with a real first-party API, and a security/configuration boundary;
- the lean and Vision prompt arms, GPT-5.6 Sol model, medium reasoning, approval/sandbox policy, command budget, and Codex flags;
- two required primary epochs and a bounded reliability matrix;
- base repositories, oracle overlays, visible regressions, hidden target graders, and repeated-oracle preflight;
- a ten-hour eligible-core-active stopping target.

Initialization canonicalizes and hashes the manifest. Preflight then binds the current fixture bytes, oracle bytes, Node/platform identity, resolved Codex launcher, Codex version, and runner configuration into a hash-chained receipt. A changed manifest needs a new campaign ID and root; a frozen campaign is never edited in place.

The smaller `manifest.smoke.local.json` performs one real Vision-arm solve before the paired campaign. Failed smoke versions remain durable negative evidence instead of being overwritten.

## Personal test sequence

First run the deterministic and adversarial gates:

```powershell
npm test
npm run portability
npm run proof
npm run evaluate:pilot:current
```

Then initialize and preflight the campaign:

```powershell
npm run campaign:init
npm run campaign:preflight
npm run campaign:status
```

Preflight is valid only when every untouched fixture passes its visible regressions but fails the hidden target, and every oracle overlay passes both. This catches already-solved, impossible, flaky, or misbound goals before model time is spent.

Start or resume work with:

```powershell
npm run campaign:run
npm run campaign:resume
```

Only one runner may own the local heartbeat lease. A concurrent runner is refused. A dead stale owner can be reclaimed after the frozen lease window; an admitted nonterminal attempt remains visible as partial evidence. Cancellation is sticky and checked between attempts:

```powershell
node plugins/vision/scripts/vision-campaign.mjs cancel `
  --root .agentic/campaigns/vision-local-tuning-20260716-v1 `
  --reason "operator requested stop"
```

Replay the result independently:

```powershell
npm run campaign:verify -- --require-accounted-hours 10
```

`verify` rehashes the manifest, preflight report, current fixture/oracle sources, attempt ledgers, model trace reduction, verifier record, outcome, and candidate workspace. It rejects duplicate or unexpected admissions, missing receipts, partial attempts, identity drift, malformed clocks, hash-valid clock reversal, mutated artifacts, stale toolchains, infrastructure-inconclusive cells, and duration padding.

## Time accounting

The ten-hour target is not elapsed wall time and is not a request to sleep. Replay reports:

- `eligible_core_active_ns`: the union of credible model, tool, build, test, verifier, and grading intervals, so concurrent work is not double-counted;
- `productive_worker_ns`: the sum of those intervals before unioning;
- `support_overhead_ns`: setup, checkpoint, and cleanup work;
- `idle_ns`: queued, paused, backoff, or idle intervals;
- `unknown_gap_ns`: cross-process or implausibly large gaps that cannot be credited;
- `invalid_padding_ns`: explicit sleep/no-op padding, which makes verification fail.

The primary matrix—every task, both arms, two epochs—must finish before the duration boundary can stop new reliability admissions. Every admitted run must terminate. If all planned work is exhausted before ten eligible hours, verification reports the shortfall; it never pads the campaign.

## Reading the result

The calibration report keeps these observations separate:

- full solves, valid task failures, and infrastructure-inconclusive attempts;
- clean passes and passes that followed a failed tool/check attempt;
- results by arm and by task/arm;
- input, cached input, uncached input, output, and reasoning tokens;
- model and verifier runtime;
- small-task duration/token overhead when both arms have observations;
- cost only when a complete pricing schedule was frozen.

There is no synthetic weighted score or significance claim. This initial corpus is used to tune Vision, so it ceases to be held out. Any claim of broad quality improvement still requires the separate 24-task, six-repository held-out evaluation in `evaluation-plan.md`.

## Ralph-style boundary

Vision provides a bounded persistent loop rather than an unlimited prompt loop:

```text
durable contract + Bead
        ↓
lease one slice → act → derive material progress → verify
        ↑                                      ↓
 resume after interruption ← typed checkpoint/terminal
```

The lifecycle controller owns lease tokens, compare-and-swap revisions, material-progress fingerprints, no-progress and authorization retry bounds, context pressure, and typed terminal states. The campaign runner evaluates that companion behavior on sealed tasks and preserves every admitted trajectory. Neither component turns repetition into authority: only acceptance-linked evidence can advance completion.

## Honest limits

Local campaign evidence is mutable and unsigned, even though mutation is detected on replay. It is not protected CI, tenant-isolated execution, real deployment proof, or a substitute for GitLab/Kubernetes environment adapters. The current local campaign is Windows-hosted; the portable installer is tested separately, while Linux/macOS campaign resilience remains unproven.
