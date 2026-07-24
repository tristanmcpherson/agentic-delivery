# Proof design

The proof fixture is a small UI and API with a contract-sensitive profile card. Its success condition includes expected failures; losing a negative case fails the proof.

## Seeded cases

1. A schema-v3 contract with resolved read-only discovery validates and emits a deterministic goal intent hash.
2. Unresolved material discovery is rejected before a goal or check can proceed.
3. A scout that claims write scope or embeds a raw transcript is rejected.
4. A valid contract-bound execution graph plans independent isolated nodes before its fan-in.
5. A cyclic graph and a builder-controlled node claiming protected verifier authority are rejected.
6. A goal whose acceptance IDs drift from the frozen contract is rejected.
7. Lifecycle activation without the exact post-research canonical goal intent is rejected.
8. A declared security risk with no required direct gate is rejected.
9. Sizing a security change as `S` cannot disguise a fast-only check as its integration gate.
10. Continuation halts on configured no-progress, repeated-authorization, reentrancy, and context-pressure conditions.
11. Advisory review passes only while its current-attempt artifact hashes remain unchanged.
12. Protected delivery binding requires a distinct controller key and exact closure, candidate, target, deployment, approval, and post-deploy evidence.
13. Local or incomplete evidence cannot request delivered-and-verified authority.
14. A mock-only contract cannot satisfy first-party acceptance.
15. Focused parser unit tests pass.
16. A mocked browser journey passes but is non-required and cannot satisfy first-party acceptance.
17. The real API returns legacy `name` instead of `displayName`; the same journey fails.
18. The shared API health probe passes while Playwright mocks the business request; provenance rejects it.
19. The browser command exits green but the contract names a required test that was not collected; test integrity rejects it.
20. A journey fails first and passes on retry; the harness reports it as non-clean.
21. A service copies the expected environment marker but reports a different deployment identity; provenance rejects it.
22. A healthy mixed UI/shared-API run passes with nonce-bound request, response, deployment, and backend correlation evidence.
23. An ephemeral real SQLite migration applies the schema, preserves data, and proves a compatible rollback.
24. A green migration command with a missing backfill is rejected by its system attestation.
25. A separate worker process consumes a nonce-correlated event and exposes the expected eventual projection.
26. A worker acknowledgement with the wrong correlation and no postcondition is rejected.
27. Flipping local config to verifier mode without a protected signed grant is rejected before execution.
28. A correctly signed grant produces closure-bound evidence in the verifier integration test.
29. A simulated post-deploy profile refuses implicit execution and runs only with explicit external approval.

The deployed case is a local simulation. It proves selection, approval gating, runtime provenance, and evidence behavior without claiming a cloud deployment or platform-enforced production approval.

## Visual completion

Mechanical proof leaves material screenshots pending. A reviewer must open the exact current image independently and record structured observations tied to its SHA-256. The harness recomputes the hash so a replaced or stale image cannot inherit the review.

## Scope

The current local fixture establishes critical mechanisms on native Windows with Playwright Chromium, built-in SQLite, a separate worker process, lifecycle/worktree tests, current-attempt advisory-review tests, and synthetic delivery-key tests. Its discovery cases prove contract consistency only, not actual subagent selection, tool-call ordering, context savings, or workspace immutability. The checked-in CI matrix is designed to exercise Windows, Linux, and macOS, but that portability claim remains pending until those hosted lanes run. The reference protected workflow is not itself evidence that an environment, key, branch policy, or distinct delivery controller has been provisioned. Cross-repository efficacy, live CI independence, real OIDC/tenant isolation, application-owned databases/queues, service workers, WebSockets, streaming, and production safety remain rollout evaluation requirements.
