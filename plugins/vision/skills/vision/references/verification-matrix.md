# Verification matrix

| Tier | Purpose | May mock | Must be real | Claim limit |
| --- | --- | --- | --- | --- |
| T0 unit/component | Logic, rendering seams, edge states | Explicit dependencies, clocks, third parties | Code/component under test | Logic/component only |
| T1 service integration | Handler, schema, migration, persistence | Uncontrolled third parties | First-party service boundary and ephemeral/isolated datastore | Service compatibility |
| T2 local full-stack | Candidate UI/CLI/API/system flow | Approved third-party stubs | Every first-party service touched by the flow | Candidate full-stack compatibility |
| T3 shared real | Candidate client against shared dev/preview services | Approved third-party sandboxes | Routing, config, auth/tenant and shared first-party service | Compatibility with that deployment |
| T4 deployed staging | Release candidate in production-like topology | Unsafe third parties may use sandboxes | Release artifacts, routing, auth, migrations, config, deployment IDs | Post-deploy release-candidate compatibility |
| T5 production smoke | Narrow rollout confirmation | No first-party mocks | Production routing and services | Limited safe smoke only |

Rules:

- T2+ provenance checks forbid first-party route fulfilment, HAR replay, response patching, and stale cached responses for the business request.
- Test service-worker product behavior separately; use a provenance lane where interception cannot conceal the network path.
- Auth, role, tenant, cookie, CORS, or authorization changes require an environment where those boundaries are real.
- Shared environments require a unique run namespace/account/data key and cleanup.
- Use Chromium for the per-change default; add browsers/viewports only for a stated compatibility risk.
- Capture full traces on failure or first retry, not for every passing run.
- When `risk_gate_version: 1` is enabled, every direct risk is mapped to a required, stage-appropriate, surface-compatible check; planning size cannot remove or downgrade the gate.
- Structured advisory lanes are current-attempt builder evidence. Require exact criteria, compatible surface, artifact hashes, adversarial cases, cleanup receipts, and a conclusive pass; they never replace protected verifier authorization.
- `delivered-and-verified` additionally requires protected post-deploy evidence and a distinct signed delivery-controller attestation bound to candidate, target, deployment, and approval.
