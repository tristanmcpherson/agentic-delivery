# Protected verifier

## Security property

`authority.mode=verifier` is a request, not authority. The harness emits `closure-verified` only when every current required check came from a run carrying a valid Ed25519 verifier grant. An unsigned run, expired grant, wrong key, changed contract, changed workspace, changed config, changed trusted harness, changed profile definition, changed runtime, wrong candidate, or wrong repository/workflow binding is rejected or made stale.

The signed binding contains:

- task ID, contract version/hash, and required check IDs;
- complete workspace fingerprint and immutable candidate ID;
- normalized config hash and protected profile-definition hashes;
- trusted harness hash and runtime/toolchain identity;
- verifier ID, issuer, repository, workflow reference, and trusted public-key fingerprint.

The grant is short-lived authorization to execute those exact checks. The completed run embeds the signed grant and its fingerprint so a status reader can revalidate the historical authorization at the run time. The private key is never accepted by the harness.

## Three-job reference controller

`.github/workflows/protected-verifier.yml` separates the trust principals:

1. **Prepare:** checks out the immutable candidate and the controller at `github.workflow_sha`; the controller's harness computes the exact grant request.
2. **Authorize:** checks out only the trusted controller, enters the protected `agentic-closure` environment, validates protected request fields, and signs with the environment-only Ed25519 private key. It does not check out candidate code or install candidate dependencies.
3. **Verify:** checks out the same candidate and controller, receives only the public key and signed grant, installs candidate dependencies, executes required checks with the trusted harness, and publishes the status plus evidence.

The workflow defaults to the non-UI proof task because it requires no browser or visual reviewer. Repositories must tailor dependency setup, profiles, credentials, visual-review authority, evidence paths, and post-deploy adapters.

## Required GitHub configuration

Create an environment named `agentic-closure` before running the workflow. Configure required reviewers, prevent self-review, restrict allowed branches/tags, and disable administrator bypass where the repository plan supports those controls. GitHub makes environment secrets available only after the job's environment protection rules pass; do not duplicate the signing key as a repository or organization secret.

Configure:

- environment secret `AGENTIC_VERIFIER_PRIVATE_KEY`: an Ed25519 PKCS#8 PEM private key;
- repository or environment variable `AGENTIC_VERIFIER_PUBLIC_KEY`: the matching SPKI PEM public key.

Protect the default branch and the workflow/controller paths. Treat changes to the harness, signer, workflow, public key, environment rules, or delivery adapter as trust-root changes requiring independent review.

## Commands

The prepare job requests authorization:

```text
node agentic-harness.mjs grant-request --root <candidate> --config <config> --task <task> --output <request.json>
```

The controller signs without running candidate code:

```text
node sign-verifier-grant.mjs --request <request.json> --output <grant.json> --expected-candidate <sha> --expected-repository <owner/repo> --expected-verifier-id <id> --expected-issuer <issuer>
```

The verifier executes the frozen candidate:

```text
node agentic-harness.mjs run --root <candidate> --config <config> --task <task> --verifier-grant <grant.json>
```

## Distinct delivery controller

Do not reuse the verifier key or infer delivery from closure. After the protected verifier reports current `closure-verified` evidence and the protected deployment/post-deploy jobs have observed the exact deployment identity, prepare a delivery request:

```text
node agentic-harness.mjs delivery-request --root <candidate> --config <config> --task <task> --target <allowlisted-target> --deployment-id <observed-id> --approval-id <id> --approved-by <actor> --approved-at <timestamp> --output <delivery-request.json>
```

A separately protected delivery-controller job validates those fields and signs without running candidate code:

```text
node sign-delivery-attestation.mjs --request <delivery-request.json> --output <delivery-attestation.json> --expected-candidate <sha> --expected-target <target> --expected-deployment-id <id> --expected-approval-id <id> --expected-controller-id <id> --expected-issuer <issuer>
```

Record the signed result with `delivery-record`. The harness revalidates the current closure hash, candidate, target, deployment, approval, every required protected post-deploy result, controller identity, expiry, signature, and distinct verifier/delivery key fingerprints before reporting `delivered-and-verified`.

Configure the delivery controller under a different protected environment and key than `agentic-closure`. The repository contains binding and signer mechanics only; it does not provision that environment or authorize a production action.

## Honest boundary

The local proof generates key pairs only to demonstrate that unsigned config flips fail, closure and delivery bindings work, and one key cannot stand in for both principals. It is not protected-CI or production-delivery evidence. The included workflow becomes a closure authority only after the repository actually provisions and protects its environment, key, controller revision, candidate checkout, profiles, and credentials. The repository does not include a live delivery workflow. Real OIDC-backed keyless signing, tenant isolation, platform attestations, and deployment adapters remain evaluation work.
