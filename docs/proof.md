# Proof design

The proof fixture is a small UI and API with a contract-sensitive profile card. Its success condition includes expected failures; losing a negative case fails the proof.

## Seeded cases

1. A schema-v3 contract with resolved read-only discovery validates and emits a deterministic goal intent hash.
2. Unresolved material discovery is rejected before a goal or check can proceed.
3. A scout that claims write scope or embeds a raw transcript is rejected.
4. A goal whose acceptance IDs drift from the frozen contract is rejected.
5. Focused parser unit tests pass.
6. A mocked browser journey passes but is non-required and cannot satisfy first-party acceptance.
7. The real API returns legacy `name` instead of `displayName`; the same journey fails.
8. The shared API health probe passes while Playwright mocks the business request; provenance rejects it.
9. The browser command exits green but the contract names a required test that was not collected; test integrity rejects it.
10. A journey fails first and passes on retry; the harness reports it as non-clean.
11. A service copies the expected environment marker but reports a different deployment identity; provenance rejects it.
12. A healthy mixed UI/shared-API run passes with nonce-bound request, response, deployment, and backend correlation evidence.
13. An ephemeral real SQLite migration applies the schema, preserves data, and proves a compatible rollback.
14. A green migration command with a missing backfill is rejected by its system attestation.
15. A separate worker process consumes a nonce-correlated event and exposes the expected eventual projection.
16. A worker acknowledgement with the wrong correlation and no postcondition is rejected.
17. Flipping local config to verifier mode without a protected signed grant is rejected before execution.
18. A correctly signed grant produces closure-bound evidence in the verifier integration test.
19. A simulated post-deploy profile refuses implicit execution and runs only with explicit external approval.

The deployed case is a local simulation. It proves selection, approval gating, runtime provenance, and evidence behavior without claiming a cloud deployment or platform-enforced production approval.

## Visual completion

Mechanical proof leaves material screenshots pending. A reviewer must open the exact current image independently and record structured observations tied to its SHA-256. The harness recomputes the hash so a replaced or stale image cannot inherit the review.

## Scope

The current local fixture establishes critical mechanisms on native Windows with Playwright Chromium, built-in SQLite, and a separate worker process. Its discovery cases prove contract consistency only, not actual subagent selection, tool-call ordering, context savings, or workspace immutability. The checked-in CI matrix is designed to exercise Windows, Linux, and macOS, but that portability claim remains pending until those hosted lanes run. The reference protected workflow is not itself evidence that an environment, key, or branch policy has been provisioned. Cross-repository efficacy, live CI independence, real OIDC/tenant isolation, application-owned databases/queues, service workers, WebSockets, streaming, and production safety remain rollout evaluation requirements.
