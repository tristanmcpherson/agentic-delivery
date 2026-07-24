# Vision work environment

Profile status: `stub`
Authority: `context-only`
Last validated against live systems: `not-yet`

This editable profile carries team and environment decisions between machines and repositories. It is not a task contract, credential, approval, verifier grant, or delivery attestation. Verify discoverable facts against the current repositories and systems before relying on them. Never store secret values, tokens, private keys, customer data, or raw logs here; record variable names and evidence references instead.

The Vision installer owns the initial template and preserves this file once the team edits it.

## Team outcome

- Desired engineering outcome: unresolved
- Initial proving scope: unresolved
- Explicit non-goals: unresolved
- Honest completion target during proving: `implemented-not-verified`

## Source control and review

- Source-control platform and hosting model: unresolved
- Default branch and branch strategy: unresolved
- Merge method: unresolved
- Required review lanes: unresolved
- Low-risk merge policy: unresolved
- Risks that require escalation: unresolved

## CI and runners

- Pipeline entry points and included templates: unresolved
- Runner operating systems, executors, tags, and network reach: unresolved
- Candidate identity source: unresolved
- Protected variables and protected job boundaries: unresolved

## Artifacts and delivery

- Build artifacts and immutable identities: unresolved
- Registries and repositories: unresolved
- Deployment controller: unresolved
- GitOps repository and version manifest: unresolved
- Branch deployment adapter and required inputs: unresolved
- Restoration adapter and required inputs: unresolved

## Environment profiles

| Environment | Purpose | Access | Approval | Data/auth isolation | Deployment identity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Local | unresolved | unresolved | unresolved | unresolved | unresolved | unresolved |
| Development | unresolved | unresolved | unresolved | unresolved | unresolved | unresolved |
| Staging | unresolved | unresolved | unresolved | unresolved | unresolved | unresolved |
| Production | unresolved | unresolved | unresolved | unresolved | unresolved | unresolved |

## Live verification

- Readiness and synchronization signals: unresolved
- API smoke checks: unresolved
- Risk-selected integration/live checks: unresolved
- Business-request correlation and postcondition source: unresolved
- Expected deployment-identity observation: unresolved
- Test identity and run-scoped data strategy: unresolved
- Cleanup assertions: unresolved

## Shared-environment lease and recovery

- Serialization or lease mechanism: unresolved
- Baseline snapshot: unresolved
- Success-path restoration: unresolved
- Failure-path diagnosis and fix-forward authority: unresolved
- Conditions that quarantine the environment: unresolved
- Evidence required before releasing the lease: unresolved

## Graduated autonomy

- Current human approval boundary: unresolved
- Target no-human boundary: unresolved
- Risk classes that qualify independently: unresolved
- Qualification thresholds and reset conditions: unresolved
- Production approval policy: unresolved

## Observability and evidence

- GitLab pipeline/job evidence: unresolved
- Kubernetes and deployment-controller evidence: unresolved
- Application logs, traces, metrics, and request IDs: unresolved
- Evidence retention and access policy: unresolved
- Beads/project-tracker integration: unresolved

## Work-machine research queue

Replace each item with a concise conclusion, confidence, and exact repository file/line or system artifact reference.

1. Inspect the application pipeline and every included CI template.
2. Inspect the GitOps repository, version manifest, deployment job, and restoration job.
3. Trace candidate SHA through artifact identity, deployment identity, live request, and restoration.
4. Confirm the shared-environment serialization, timeout, cancellation, and stale-lock behavior.
5. Confirm least-privilege test credentials, run-scoped data, cleanup, and tenant boundaries.
6. Identify which risk-selected checks exist and which adapters must be added.
7. Confirm protected verifier, AI-review, merge-controller, and delivery-controller trust boundaries.
8. Measure current pipeline reliability and agree on autonomy qualification thresholds.

## Continuation rule

On a capable work machine, resolve this research queue before candidate edits or persistent-goal creation. Use one to three bounded read-only scouts for independent repository, pipeline, GitOps, and verification questions. Synthesize only evidence-backed conclusions, ask only the remaining owner decisions, then freeze the task contract and create the exact canonical goal through the available authorized goal tool.
