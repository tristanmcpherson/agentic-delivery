# Sol Pro independent review

On July 14, 2026, GPT-5.6 Sol Pro received the proposed architecture, proof claims, and primary-source starting points as an independent red-team review. It returned a qualified source audit and the verdict: **revise materially, then build a narrow v1**.

## Highest-value findings adopted

- The original builder could define the contract, change tests/profiles, issue evidence, review its own screenshots, and close Beads. The revised model separates builder, verifier, and delivery-controller principals and calls local output `locally-verified` rather than closure-grade.
- A marker header proves little by itself. The proof now requires the exact business request, an unpredictable nonce, request/response/deployment IDs, a response-derived UI assertion, and independently queried backend correlation.
- The original six public skills and three-axis S/V/A taxonomy were excessive. v1 uses one skill; size remains only for plan persistence, while direct risks select gates and action boundaries select approval.
- Contract/worktree hashes were incomplete evidence identity. Runs now also bind contract version, config, harness, profile, toolchain, test IDs/results, and artifact hashes; external adapters can add immutable candidate and deployment IDs.
- Green test commands can conceal missing, skipped, focused, or retry-only tests. The Playwright reporter and harness enforce expected-test integrity.
- Screenshot presence is not inspection. Structured review is bound to exact image hashes, with human approval recommended for critical visual changes until an automated reviewer passes challenge-image evaluation.
- Beads is work-state infrastructure, not a verification authority.

## Qualified or deliberately retained

- The review recommended repo-local iteration before plugin packaging. The framework retains a marketplace package because portability into Codex is an explicit product requirement, but the plugin is only transport for one skill and is outside the verification trust root.
- It recommended postponing production smoke. The template keeps production disabled and v1 relies on staging; the proof retains a local simulated production profile solely to test refusal and approval mechanics. It is not evidence of real production safety.
- It recommended removing Stagehand from v1. Stagehand is now optional exploration only and not part of deterministic acceptance or production use.
- It recommended deleting S/M/L entirely from policy. The user specifically needs automatic size calibration with override, so size remains strictly as a planning-persistence hint and has no verification or permission effect.

## Unresolved

Universal backend/deployment provenance is impossible without application, gateway, observability, or delivery-platform cooperation. Service workers, streaming, WebSockets, native applications, and offline-first systems need protocol-specific adapters. The framework remains experimental until it passes the evaluation plan.

## Subsequent hardening

The next iteration closed one implementation gap identified by the trust model: verifier mode now requires a short-lived Ed25519 grant over the complete current evidence identity, and every required run used for closure must revalidate that grant. A separate protected-controller workflow keeps the signing key out of candidate jobs. The adversarial proof rejects a local config flip, while integration tests exercise valid signing and evidence invalidation.

It also adds a generic nonce-bound system-attestation protocol, an ephemeral real SQLite migration/backfill/rollback fixture, a separate async worker-process fixture, an executable 20-case pilot evaluator, and a Windows/Linux/macOS CI matrix. A later orchestration iteration adds calibrated read-only discovery before persistent-goal creation, a backward-compatible schema-v3 intake/goal contract, and deterministic goal generation. Mechanical validation proves contract consistency only; actual delegation, context savings, read-only behavior, and tool ordering remain model-driven evaluation questions. These additions narrow the gaps; they do not substitute for actually running protected CI, hosted portability lanes, or the held-out evaluation.

The review corroborated claims primarily against OpenAI's [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6), [Harness Engineering](https://openai.com/index/harness-engineering/), Playwright's [best practices](https://playwright.dev/docs/best-practices), [API testing](https://playwright.dev/docs/api-testing), [auth](https://playwright.dev/docs/auth), and the official [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp). Its recommendations remain engineering judgments until measured.
