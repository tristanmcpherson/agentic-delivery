# Trust model

## Principals

- **Scout:** performs bounded read-only research and returns evidence-backed summaries; cannot edit, approve, verify, set goals, or expand authority.
- **Planner/builder:** proposes the contract and changes candidate code and task-specific tests.
- **Verifier:** consumes a frozen contract, immutable candidate, protected profiles, and scoped credentials; issues closure evidence.
- **Delivery controller:** invokes protected CI/CD, records artifact/deployment identities, runs required post-deploy checks, and mirrors the decision into Beads.

These can use the same model but must be separated by permissions, credentials, protected inputs, and artifact controls for closure-grade evidence.

Scout separation is a context-management technique, not an independence claim. A second agent or thread remains builder-side unless protected permissions and credentials establish a verifier boundary.

## Verifier grants

`authority.mode=verifier` is not proof of independence. The protected controller signs a short-lived Ed25519 grant over the exact task, required checks, workspace, candidate ID, config, harness, profile definitions, runtime, repository, workflow, verifier identity, and public-key fingerprint. The candidate job receives only the grant and public key. Every required result used for `closure-verified` must revalidate against that signed binding.

Keep the private key in a separately approved controller job that does not check out candidate code or install candidate dependencies. Use the trusted controller's harness for both request preparation and verification. Protect and pin the controller revision and workflow path.

## Evidence identity

Bind evidence to the contract version/hash, complete candidate state, harness version/hash, protected profile ID/hash, runtime configuration, tool/browser versions, auth role/tenant, data namespace, UI/API artifact or deployment IDs, check/test IDs, raw artifact hashes, and expiration rules.

## Business-flow provenance

A health check and marker header do not prove the user flow reached the intended service. Prefer this bundle:

1. exact allowed origins and deployment identities from a protected profile;
2. fresh browser context and unpredictable run nonce;
3. exact method, destination, redirects, request ID, payload/operation fingerprint, status, response hash, and selected redacted response fields for the business request;
4. UI assertion that depends on a unique server result;
5. independent backend log/correlation record or server-side postcondition using separate read-only credentials;
6. immutable manifest binding both sides and the candidate/deployment identities.

Apps without gateway/backend support may produce local developer evidence, but should report that closure-grade provenance is unavailable.

## Visual review

Hash every image. The review records reviewer identity/authority, criterion, run, URL, profile, viewport, browser, visible state, expected elements, anomalies, verdict, confidence, and exact image hash. A Boolean alone is insufficient. Critical visual changes require a human or an independently evaluated reviewer.

## System adapters

For migrations, persistence, queues, workers, CLI, or infrastructure, a repository adapter may write the harness system-attestation protocol. It must identify the real subject, bind the run nonce/correlation, hash operation inputs and outputs, and report the exact contract-required assertions. An adapter file proves only the boundary actually exercised; protected verifier separation is still required for closure.
