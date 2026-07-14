# Agentic Delivery framework

This repository packages the `agentic-delivery` Codex plugin and its executable proof fixture.

## Map

- `plugins/agentic-delivery/skills/agentic-delivery/` contains the single outcome-driven workflow, including calibrated read-only discovery before contract-bound goal creation.
- `plugins/agentic-delivery/scripts/agentic-harness.mjs` produces and validates developer/verifier evidence; protected CI is the closure authority.
- `plugins/agentic-delivery/assets/project-template/` is installed into target repositories.
- `docs/verification-model.md` defines environment truth and evidence requirements.
- `docs/protected-verifier.md` defines signed grant authority and the three-job controller boundary.
- `proof/` demonstrates mock-only, business-request provenance, test-integrity, deployment-identity, visual-review, and approval controls.
- `evaluation/` contains the executable pilot manifest; the full held-out evaluation remains separate.

## Verification

Run `npm test` for deterministic harness tests and `npm run proof` for the browser-backed proof. Run both before treating framework changes as complete.

Do not weaken a failing acceptance assertion to make the proof pass. Fix the framework or fixture, and preserve the negative case that demonstrates a mock-only UI test can miss a real API incompatibility.
