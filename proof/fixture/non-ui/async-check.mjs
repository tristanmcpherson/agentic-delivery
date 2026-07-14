import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const mode = process.argv.includes("--broken") ? "broken" : "healthy";
const artifactDir = process.env.AGENTIC_ARTIFACT_DIR;
const attestationFile = process.env.AGENTIC_SYSTEM_ATTESTATION;
const nonce = process.env.AGENTIC_RUN_NONCE;
if (!artifactDir || !attestationFile || !nonce) throw new Error("Agentic evidence environment is incomplete.");

function hash(value) {
  const input = Buffer.isBuffer(value) ? value : typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(input).digest("hex");
}

async function waitForOutput(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  return null;
}

await fs.mkdir(artifactDir, { recursive: true });
const inputFile = path.join(artifactDir, "queue-event.json");
const outputFile = path.join(artifactDir, "worker-result.json");
const event = {
  message_id: `profile-${nonce.slice(0, 12)}`,
  correlation_id: nonce,
  type: "profile.updated",
  payload: { profile_id: "profile-1", display_name: `Avery ${nonce.slice(0, 8)}` },
};
await fs.writeFile(inputFile, `${JSON.stringify(event, null, 2)}\n`, "utf8");
const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "async-worker.mjs");
const child = spawn(process.execPath, [workerFile, inputFile, outputFile, mode], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const result = await waitForOutput(outputFile);
const exitCode = await new Promise((resolve) => child.on("close", (code) => resolve(code ?? -1)));
const consumed = exitCode === 0 && result !== null;
const correlated = result?.correlation_id === nonce && result?.message_id === event.message_id;
const postcondition = result?.status === "processed" && result?.projection?.profile_id === event.payload.profile_id && result?.projection?.indexed === true;
const assertions = [
  { id: "event-enqueued", status: "pass", evidence_sha256: hash(event) },
  { id: "worker-consumed", status: consumed ? "pass" : "fail", evidence_sha256: hash({ exitCode, stderr, result }) },
  { id: "correlation-matched", status: correlated ? "pass" : "fail", evidence_sha256: hash({ expected: nonce, actual: result?.correlation_id }) },
  { id: "postcondition-observed", status: postcondition ? "pass" : "fail", evidence_sha256: hash({ result }) },
];
const nonceHash = hash(nonce);
const attestation = {
  schema_version: 1,
  kind: "async",
  task_id: process.env.AGENTIC_TASK_ID,
  check_id: process.env.AGENTIC_CHECK_ID,
  run_nonce_sha256: nonceHash,
  correlation_id_sha256: nonceHash,
  subject: { type: "filesystem-queue", identity: `sha256:${hash({ input: await fs.readFile(inputFile), output: result })}` },
  operation: { id: "profile-index-projection", input_sha256: hash(event), output_sha256: hash(result || {}) },
  assertions,
  details: { event, result, worker_exit_code: exitCode },
};
await fs.writeFile(attestationFile, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
console.log(`async fixture ${mode}: ${assertions.map((item) => `${item.id}=${item.status}`).join(", ")}`);
