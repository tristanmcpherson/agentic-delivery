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
  const name = String(args["private-key-env"] || "AGENTIC_VERIFIER_PRIVATE_KEY");
  const value = process.env[name];
  if (!value) throw new Error(`Verifier private key is unavailable; set ${name} or pass --private-key-file.`);
  return value.includes("\\n") && !value.includes("\n") ? value.replaceAll("\\n", "\n") : value;
}

function expectBinding(binding, field, expected) {
  if (expected === undefined || expected === true) return;
  if (String(binding[field] ?? "") !== String(expected)) throw new Error(`Grant request ${field} did not match the protected controller input.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.request || args.request === true) throw new Error("Pass --request <grant-request.json>.");
  if (!args.output || args.output === true) throw new Error("Pass --output <verifier-grant.json>.");
  const request = JSON.parse(await fs.readFile(path.resolve(String(args.request)), "utf8"));
  const binding = request?.binding;
  if (request?.schema_version !== 1 || binding?.schema_version !== 1 || binding?.purpose !== "vision-closure") throw new Error("Invalid verifier grant request.");
  if (!binding.candidate_id || !binding.contract_hash || !binding.workspace_fingerprint || !binding.config_hash || !binding.harness_hash) throw new Error("Verifier grant request is missing required evidence bindings.");
  if (!Array.isArray(binding.required_checks) || binding.required_checks.length === 0) throw new Error("Verifier grant request has no required checks.");
  expectBinding(binding, "candidate_id", args["expected-candidate"]);
  expectBinding(binding, "repository", args["expected-repository"]);
  expectBinding(binding, "verifier_id", args["expected-verifier-id"]);
  expectBinding(binding, "issuer", args["expected-issuer"]);
  expectBinding(binding, "workflow_ref", args["expected-workflow-ref"]);

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
  const grant = {
    schema_version: 1,
    algorithm: "Ed25519",
    payload,
    signature: sign(null, Buffer.from(stableStringify(payload)), privateKey).toString("base64"),
  };
  const output = path.resolve(String(args.output));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(grant, null, 2)}\n`, "utf8");
  console.log(`Wrote signed verifier grant ${output}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
