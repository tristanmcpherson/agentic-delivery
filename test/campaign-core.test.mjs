import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendLedgerEvent,
  freezeCampaignManifest,
  parseCodexJsonl,
  redactSensitiveText,
  replayCampaignAccounting,
  serializeRedactedCodexJsonl,
  verifyFrozenManifest,
  verifyLedger,
} from "../plugins/vision/scripts/campaign-core.mjs";

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("frozen campaign manifests are canonical, content-bound, and tamper evident", () => {
  const left = freezeCampaignManifest({
    schema_version: 1,
    campaign_id: "C-1",
    tasks: [{ id: "logic", epochs: 2 }],
    arms: { vision: { prompt: "bounded" }, lean: { prompt: "lean" } },
  });
  const right = freezeCampaignManifest({
    arms: { lean: { prompt: "lean" }, vision: { prompt: "bounded" } },
    tasks: [{ epochs: 2, id: "logic" }],
    campaign_id: "C-1",
    schema_version: 1,
  });
  assert.equal(left.manifest_sha256, right.manifest_sha256);
  assert.deepEqual(verifyFrozenManifest(left), { valid: true, errors: [] });

  const tampered = structuredClone(left);
  tampered.manifest.tasks[0].epochs = 200;
  const verdict = verifyFrozenManifest(tampered);
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join("\n"), /manifest hash mismatch/);
});

test("append-only event files serialize concurrent writers and replay one exact hash chain", async () => {
  const root = await temporaryDirectory("vision-campaign-ledger-");
  try {
    const ledger = path.join(root, "events");
    const settled = await Promise.allSettled(Array.from({ length: 24 }, (_, index) => appendLedgerEvent({
      ledger_dir: ledger,
      campaign_id: "C-ledger",
      ledger_kind: "campaign",
      event_type: "heartbeat",
      state_after: "support_active",
      payload: { index },
    })));
    const rejected = settled.filter((result) => result.status === "rejected");
    assert.deepEqual(
      rejected.map((result) => ({ code: result.reason?.code, message: result.reason?.message })),
      [],
      "all concurrent ledger writers must survive transient lock contention",
    );
    const verified = await verifyLedger(ledger);
    assert.equal(verified.valid, true, verified.errors.join("\n"));
    assert.equal(verified.events.length, 24);
    assert.deepEqual(verified.events.map((event) => event.seq), Array.from({ length: 24 }, (_, index) => index + 1));
    assert.equal(new Set(verified.events.map((event) => event.event_hash)).size, 24);

    const [firstFile] = (await fs.readdir(ledger)).filter((name) => name.endsWith(".json")).sort();
    const firstPath = path.join(ledger, firstFile);
    const first = JSON.parse(await fs.readFile(firstPath, "utf8"));
    first.payload.index = 999;
    await fs.writeFile(firstPath, `${JSON.stringify(first, null, 2)}\n`, "utf8");
    const tampered = await verifyLedger(ledger);
    assert.equal(tampered.valid, false);
    assert.match(tampered.errors.join("\n"), /event hash mismatch/);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

test("Codex JSONL parser classifies terminals, deltas cumulative resume usage, and keeps turn-local item identity", () => {
  const jsonl = [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    { type: "item.started", item: { id: "item_0", type: "command_execution", command: "npm test", status: "in_progress", aggregated_output: "" } },
    { type: "item.completed", item: { id: "item_0", type: "command_execution", command: "npm test", status: "failed", exit_code: 1, aggregated_output: "first failed" } },
    { type: "item.completed", item: { id: "item_1", type: "agent_message", text: "fixed it" } },
    { type: "turn.completed", usage: { input_tokens: 25606, cached_input_tokens: 22016, output_tokens: 17, reasoning_output_tokens: 0 } },
  ].map(JSON.stringify).join("\n");
  const parsed = parseCodexJsonl({
    attempt_id: "A-resume",
    stdout: jsonl,
    stderr: "",
    exit_code: 0,
    timed_out: false,
    previous_terminal_usage: { input_tokens: 12789, cached_input_tokens: 9984, output_tokens: 8, reasoning_output_tokens: 0 },
  });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.terminal.classification, "success");
  assert.deepEqual(parsed.usage, {
    input_tokens: 12817,
    cached_input_tokens: 12032,
    uncached_input_tokens: 785,
    output_tokens: 9,
    reasoning_output_tokens: 0,
  });
  assert.equal(parsed.tool_outcomes[0].outcome, "failed");
  assert.equal(parsed.thread_id, "thread-1");
  assert.equal(parsed.items[0].composite_id, "A-resume:1:item_0");
});

test("Codex JSONL parser fails closed on timeout, malformed lines, and incomplete protocol", () => {
  const completed = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } });
  const timedOut = parseCodexJsonl({ attempt_id: "A-timeout", stdout: completed, stderr: "", exit_code: 0, timed_out: true });
  assert.equal(timedOut.terminal.classification, "timeout");

  const malformed = parseCodexJsonl({ attempt_id: "A-bad", stdout: `${completed}\n{broken`, stderr: "", exit_code: 0, timed_out: false });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.terminal.classification, "instrumentation_failure");
  assert.match(malformed.errors.join("\n"), /line 2/);

  const incomplete = parseCodexJsonl({ attempt_id: "A-empty", stdout: "", stderr: "argument error", exit_code: 0, timed_out: false });
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.terminal.classification, "protocol_incomplete");
});

test("unknown Codex events survive parsing and secrets are redacted before durable telemetry", () => {
  const stdout = [
    JSON.stringify({ type: "future.event", secret: "preserve-shape" }),
    JSON.stringify({ type: "turn.failed", error: { message: "Authorization: Bearer abc.def.ghi" } }),
  ].join("\n");
  const parsed = parseCodexJsonl({ attempt_id: "A-unknown", stdout, stderr: "AWS_SECRET_ACCESS_KEY=abcd1234", exit_code: 1, timed_out: false });
  assert.equal(parsed.terminal.classification, "turn_failed");
  assert.equal(parsed.unknown_events.length, 1);
  assert.doesNotMatch(JSON.stringify(parsed), /abc\.def\.ghi|abcd1234/);
  assert.equal(redactSensitiveText("token=plain Authorization: Bearer top-secret"), "token=[REDACTED] Authorization: Bearer [REDACTED]");
});

test("Codex JSONL redaction preserves valid structured telemetry", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-redaction" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_0",
        type: "command_execution",
        status: "completed",
        exit_code: 0,
        aggregated_output: 'diff: secret: "from-file"',
      },
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 4, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }),
  ].join("\n");
  const parsed = parseCodexJsonl({ attempt_id: "A-redaction", stdout, stderr: "", exit_code: 0, timed_out: false });
  assert.equal(parsed.valid, true, parsed.errors.join("\n"));

  const durable = serializeRedactedCodexJsonl(parsed.events);
  assert.doesNotMatch(durable, /from-file/);
  assert.match(durable, /REDACTED/);
  for (const line of durable.trim().split(/\r?\n/)) assert.doesNotThrow(() => JSON.parse(line));
});

test("campaign accounting unions concurrent active intervals and excludes incredible gaps", () => {
  const second = 1_000_000_000n;
  const event = (segment, monoSeconds, wallSeconds, state) => ({
    clock: { segment_id: segment, mono_ns: String(BigInt(monoSeconds) * second) },
    wall_time_utc: new Date(wallSeconds * 1000).toISOString(),
    state_after: state,
  });
  const ledgers = [
    [event("S-1", 0, 0, "model_inflight"), event("S-1", 10, 10, "idle"), event("S-1", 20, 20, "terminal")],
    [event("S-2", 0, 5, "tool_inflight"), event("S-2", 10, 15, "idle")],
    [event("S-3", 0, 30, "verifier_inflight"), event("S-3", 20, 50, "terminal")],
  ];
  const accounting = replayCampaignAccounting(ledgers, { max_credible_gap_ns: String(15n * second) });
  assert.equal(accounting.eligible_core_active_ns, String(15n * second));
  assert.equal(accounting.productive_worker_ns, String(20n * second));
  assert.equal(accounting.unknown_gap_ns, String(20n * second));
  assert.equal(accounting.invalid_padding_ns, "0");
});

test("campaign accounting does not report an outer-ledger gap as unknown when attempt heartbeats cover the same wall interval", () => {
  const second = 1_000_000_000n;
  const event = (segment, monoSeconds, wallSeconds, state) => ({
    clock: { segment_id: segment, mono_ns: String(BigInt(monoSeconds) * second) },
    wall_time_utc: new Date(wallSeconds * 1000).toISOString(),
    state_after: state,
  });
  const outer = [event("outer", 0, 0, "support_active"), event("outer", 100, 100, "idle")];
  const attempt = [];
  for (let value = 0; value <= 100; value += 10) attempt.push(event("attempt", value, value, value === 100 ? "terminal" : "model_inflight"));
  const accounting = replayCampaignAccounting([outer, attempt], { max_credible_gap_ns: String(15n * second) });
  assert.equal(accounting.eligible_core_active_ns, String(100n * second));
  assert.equal(accounting.unknown_gap_ns, "0");
});

test("ledger verification rejects hash-valid malformed and non-monotonic clocks", async () => {
  const root = await temporaryDirectory("vision-campaign-clock-");
  try {
    const malformed = path.join(root, "malformed");
    await appendLedgerEvent({
      ledger_dir: malformed,
      campaign_id: "C-clock",
      ledger_kind: "campaign",
      event_type: "heartbeat",
      state_after: "support_active",
      clock: { segment_id: "segment", mono_ns: "not-a-number" },
    });
    const malformedVerdict = await verifyLedger(malformed);
    assert.equal(malformedVerdict.valid, false);
    assert.match(malformedVerdict.errors.join("\n"), /invalid monotonic clock/i);

    const backward = path.join(root, "backward");
    await appendLedgerEvent({
      ledger_dir: backward,
      campaign_id: "C-clock",
      ledger_kind: "campaign",
      event_type: "heartbeat",
      state_after: "support_active",
      clock: { segment_id: "segment", mono_ns: "10" },
    });
    await appendLedgerEvent({
      ledger_dir: backward,
      campaign_id: "C-clock",
      ledger_kind: "campaign",
      event_type: "heartbeat",
      state_after: "support_active",
      clock: { segment_id: "segment", mono_ns: "5" },
    });
    const backwardVerdict = await verifyLedger(backward);
    assert.equal(backwardVerdict.valid, false);
    assert.match(backwardVerdict.errors.join("\n"), /moved backward/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});
