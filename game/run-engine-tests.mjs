import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "tests/game-engine.test.mjs"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  encoding: "utf8"
});

process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");

const collected = [...(run.stdout || "").matchAll(/^# Subtest: (.+)$/gm)].map((match, index) => ({
  id: `game-engine-${index + 1}`,
  title: match[1].trim(),
  expected_status: "passed",
  location: "tests/game-engine.test.mjs"
}));
const results = [...(run.stdout || "").matchAll(/^(not )?ok \d+ - (.+?)(?: # (SKIP|TODO).*)?$/gm)].map((match, index) => ({
  id: `game-engine-${index + 1}`,
  title: match[2].trim(),
  expected_status: "passed",
  status: match[3] === "SKIP" ? "skipped" : match[1] ? "failed" : "passed",
  retry: 0
}));

if (process.env.AGENTIC_TEST_MANIFEST) {
  fs.mkdirSync(path.dirname(process.env.AGENTIC_TEST_MANIFEST), { recursive: true });
  fs.writeFileSync(process.env.AGENTIC_TEST_MANIFEST, `${JSON.stringify({
    schema_version: 1,
    overall_status: run.status === 0 ? "passed" : "failed",
    collected,
    results
  }, null, 2)}\n`);
}

process.exitCode = run.status ?? 1;
