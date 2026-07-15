#!/usr/bin/env node

import { createPrivateKey, randomBytes, sign } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return args;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

async function readPrivateKey(args) {
  if (args["private-key-file"] && args["private-key-file"] !== true) return fs.readFile(path.resolve(String(args["private-key-file"])), "utf8");
  const name = String(args["private-key-env"] || "AGENTIC_DELIVERY_PRIVATE_KEY");
  const value = process.env[name];
  if (!value) throw new Error(`Delivery-controller private key is unavailable; set ${name} or pass --private-key-file.`);
  return value.includes("\\n") && !value.includes("\n") ? value.replaceAll("\\n", "\n") : value;
}

function expectBinding(binding, field, expected) {
  if (expected === undefined || expected === true) return;
  if (String(binding[field] ?? "") !== String(expected)) throw new Error(`Delivery request ${field} did not match the protected controller input.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.request || args.request === true) throw new Error("Pass --request <delivery-request.json>.");
  if (!args.output || args.output === true) throw new Error("Pass --output <delivery-attestation.json>.");
  const request = JSON.parse(await fs.readFile(path.resolve(String(args.request)), "utf8"));
  const binding = request?.binding;
  if (request?.schema_version !== 1 || binding?.schema_version !== 1 || binding?.purpose !== "vision-release") throw new Error("Invalid delivery attestation request.");
  for (const field of ["controller_id", "candidate_id", "contract_hash", "closure_status_sha256", "target", "deployment_id", "trusted_public_key_sha256", "protected_verifier_public_key_sha256"]) if (!binding[field]) throw new Error(`Delivery request is missing ${field}.`);
  if (!binding.approval?.id || !binding.approval?.approved_by || !binding.approval?.approved_at) throw new Error("Delivery request is missing explicit approval binding.");
  if (!Array.isArray(binding.required_post_deploy_checks) || binding.required_post_deploy_checks.length === 0) throw new Error("Delivery request has no required post-deploy checks.");
  expectBinding(binding, "candidate_id", args["expected-candidate"]);
  expectBinding(binding, "target", args["expected-target"]);
  expectBinding(binding, "deployment_id", args["expected-deployment-id"]);
  expectBinding(binding, "controller_id", args["expected-controller-id"]);
  expectBinding(binding, "issuer", args["expected-issuer"]);
  expectBinding(binding.approval, "id", args["expected-approval-id"]);
  expectBinding(binding.approval, "approved_by", args["expected-approved-by"]);

  const ttlSeconds = Number(args["ttl-seconds"] || 600);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) throw new Error("--ttl-seconds must be an integer between 60 and 86400.");
  const issuedAt = new Date();
  const payload = {
    binding,
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
    controller_nonce: randomBytes(16).toString("hex"),
  };
  const privateKey = createPrivateKey(await readPrivateKey(args));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error(`Expected an Ed25519 private key, got ${privateKey.asymmetricKeyType || "unknown"}.`);
  const envelope = {
    schema_version: 1,
    algorithm: "Ed25519",
    payload,
    signature: sign(null, Buffer.from(stableStringify(payload)), privateKey).toString("base64"),
  };
  const output = path.resolve(String(args.output));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  console.log(`Wrote signed delivery attestation ${output}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
