import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readStatus(taskId) {
  return JSON.parse(await fs.readFile(path.join(root, "proof", "evidence", taskId, "latest.json"), "utf8"));
}

const healthy = await readStatus("PROOF-HEALTHY");
const production = await readStatus("PROOF-PRODUCTION");
const nonUi = await readStatus("PROOF-NON-UI");
const negativeIds = ["PROOF-BROKEN", "PROOF-BUSINESS-MOCKED", "PROOF-MISSING-TEST", "PROOF-RETRY-ONLY", "PROOF-MARKER-SPOOF", "PROOF-MIGRATION-BROKEN", "PROOF-ASYNC-BROKEN"];
const negatives = Object.fromEntries(await Promise.all(negativeIds.map(async (id) => [id, (await readStatus(id)).overall_status])));
const mechanical = JSON.parse(await fs.readFile(path.join(root, "proof", "mechanical-report.json"), "utf8"));

if (healthy.overall_status !== "locally-verified" || production.overall_status !== "locally-verified" || nonUi.overall_status !== "locally-verified") {
  throw new Error(`Positive proof is not locally verified: healthy=${healthy.overall_status}, production=${production.overall_status}, non-ui=${nonUi.overall_status}`);
}
for (const [id, status] of Object.entries(negatives)) {
  if (status !== "failed") throw new Error(`Expected adversarial proof ${id} to be failed, got ${status}`);
}
if (mechanical.result !== "pass" || mechanical.outcomes.some((outcome) => outcome.matched_expectation !== true)) throw new Error("Mechanical outcome report is incomplete or contains an unexpected result.");
if (!mechanical.outcomes.some((outcome) => outcome.id === "false-closure-config-flip" && outcome.matched_expectation === true)) throw new Error("False-closure config-flip rejection was not proven.");

const checks = [...healthy.checks, ...production.checks, ...nonUi.checks].filter((check) => check.required);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  result: "locally-verified",
  authority: "local",
  positive_tasks: { "PROOF-HEALTHY": healthy.overall_status, "PROOF-PRODUCTION": production.overall_status, "PROOF-NON-UI": nonUi.overall_status },
  expected_negative_tasks: negatives,
  mechanical_outcomes: mechanical.outcomes,
  evidence: checks.map((check) => ({
    check_id: check.id,
    state: check.state,
    profile_hash: check.result?.profile_hash || null,
    test_manifest: check.result?.artifacts?.test_manifest || null,
    business_flow_provenance: check.result?.artifacts?.business_flow_provenance || null,
    system_attestation: check.result?.artifacts?.system_attestation || null,
    screenshot_hashes: check.result?.artifacts?.screenshot_hashes || {},
    visual_review: check.result?.visual_review || null
  })),
  limits: "This is local developer evidence with simulated protected-grant mechanics, not a live protected-CI closure run or a completed cross-repository evaluation."
};
await fs.writeFile(path.join(root, "proof", "last-proof.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("PASS proof finalized as locally-verified.");
