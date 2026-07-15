# Protected verifier adapter

Local mode can issue only `locally-verified`. To enable verifier mode, run the installed harness from a trusted controller checkout and supply these protected inputs:

- `AGENTIC_AUTHORITY_MODE=verifier`
- `AGENTIC_VERIFIER_ID`
- `AGENTIC_VERIFIER_ISSUER`
- `AGENTIC_VERIFIER_REPOSITORY`
- `AGENTIC_VERIFIER_WORKFLOW_REF`
- `AGENTIC_VERIFIER_PUBLIC_KEY`
- `AGENTIC_CANDIDATE_ID`

Generate a grant request with `grant-request`. Sign it in a separate protected controller job using an Ed25519 private key that is never exposed to candidate code. Run the required checks with `--verifier-grant` in a job that has the public key but not the private key.

Copy and tailor the framework's `.github/workflows/protected-verifier.yml`. Pin the controller checkout, immutable candidate, environment protections, setup commands, evidence path, and delivery adapter for this repository before accepting closure evidence.

`closure-verified` does not imply delivery. Configure `delivery.controller_id` and a separate `delivery.trust` public key only after provisioning a distinct protected delivery-controller job. After protected post-deploy checks observe the exact deployment identity, use `delivery-request`, sign with `sign-delivery-attestation.mjs` in that separate controller, and record with `delivery-record`. The harness rejects reused verifier/delivery keys, local closure, missing post-deploy evidence, or mismatched candidate, target, deployment, and approval bindings.
