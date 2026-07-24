import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ZERO_HASH = "0".repeat(64);
const EVENT_FILE_PATTERN = /^(\d{9})-([a-f0-9]{64})\.json$/;
const segmentStartedNs = process.hrtime.bigint();
const processSegmentId = `segment-${process.pid}-${randomUUID()}`;

const CORE_ACTIVE_STATES = new Set([
  "model_inflight",
  "agent_acting",
  "tool_inflight",
  "build_inflight",
  "test_inflight",
  "verifier_inflight",
  "grading_inflight",
]);
const SUPPORT_STATES = new Set(["support_active", "setup_active", "checkpoint_active", "cleanup_active"]);
const IDLE_STATES = new Set(["idle", "queued", "backoff", "paused"]);
const PADDING_STATES = new Set(["invalid_padding", "sleep_padding", "noop_padding"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers");
  if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Value(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function freezeCampaignManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new TypeError("campaign manifest must be an object");
  if (manifest.schema_version !== 1) throw new TypeError("campaign manifest schema_version must be 1");
  if (typeof manifest.campaign_id !== "string" || !manifest.campaign_id.trim()) throw new TypeError("campaign manifest requires campaign_id");
  const frozen = stableValue(manifest);
  return {
    schema_version: 1,
    manifest: frozen,
    manifest_sha256: sha256Value(frozen),
  };
}

export function verifyFrozenManifest(frozen) {
  const errors = [];
  if (!frozen || typeof frozen !== "object" || Array.isArray(frozen)) return { valid: false, errors: ["frozen manifest must be an object"] };
  if (frozen.schema_version !== 1) errors.push("frozen manifest schema_version must be 1");
  if (!frozen.manifest || typeof frozen.manifest !== "object" || Array.isArray(frozen.manifest)) errors.push("frozen manifest requires manifest object");
  if (!HASH_PATTERN.test(frozen.manifest_sha256 || "")) errors.push("frozen manifest requires a SHA-256 digest");
  else if (frozen.manifest && sha256Value(frozen.manifest) !== frozen.manifest_sha256) errors.push("manifest hash mismatch");
  return { valid: errors.length === 0, errors };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (process.platform !== "win32") throw error;
  } finally {
    await handle?.close();
  }
}

async function acquireAppendLock(ledgerDir, options = {}) {
  const timeoutMs = options.timeout_ms ?? 10_000;
  const staleMs = options.stale_ms ?? 60_000;
  const lockPath = path.join(ledgerDir, ".append.lock");
  const deadline = Date.now() + timeoutMs;
  await fs.mkdir(ledgerDir, { recursive: true });
  while (Date.now() <= deadline) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`, "utf8");
      await handle.sync();
      return {
        async release() {
          await handle.close();
          await fs.rm(lockPath, { force: true });
        },
      };
    } catch (error) {
      const isWindowsLockContention = process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code);
      if (error.code !== "EEXIST" && !isWindowsLockContention) throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) await fs.rm(lockPath, { force: true });
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await delay(4 + Math.floor(Math.random() * 8));
    }
  }
  throw new Error(`Timed out acquiring ledger append lock: ${lockPath}`);
}

function eventBody(input, previous, sequence) {
  const clock = input.clock || {
    segment_id: processSegmentId,
    mono_ns: String(process.hrtime.bigint() - segmentStartedNs),
  };
  return stableValue({
    schema_version: 1,
    campaign_id: input.campaign_id,
    ledger_kind: input.ledger_kind,
    seq: sequence,
    event_id: input.event_id || randomUUID(),
    event_type: input.event_type,
    wall_time_utc: input.wall_time_utc || new Date().toISOString(),
    clock,
    scope: input.scope || {},
    actor: input.actor || { pid: process.pid },
    state_after: input.state_after || null,
    resource_delta: input.resource_delta || {},
    payload: sanitizeValue(input.payload || {}),
    prev_event_hash: previous?.event_hash || ZERO_HASH,
  });
}

async function writeDurableJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
  await syncDirectory(path.dirname(filePath));
}

export async function appendLedgerEvent(input) {
  if (!input || typeof input !== "object") throw new TypeError("ledger event input must be an object");
  for (const field of ["ledger_dir", "campaign_id", "ledger_kind", "event_type"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new TypeError(`ledger event requires ${field}`);
  }
  const ledgerDir = path.resolve(input.ledger_dir);
  const lock = await acquireAppendLock(ledgerDir, input.lock_options);
  try {
    const current = await verifyLedger(ledgerDir);
    if (!current.valid) throw new Error(`Refusing to append to invalid ledger:\n- ${current.errors.join("\n- ")}`);
    const previous = current.events.at(-1) || null;
    if (previous && previous.campaign_id !== input.campaign_id) throw new Error("campaign_id does not match existing ledger");
    if (previous && previous.ledger_kind !== input.ledger_kind) throw new Error("ledger_kind does not match existing ledger");
    const body = eventBody(input, previous, current.events.length + 1);
    const event = { ...body, event_hash: sha256Value(body) };
    const filename = `${String(event.seq).padStart(9, "0")}-${event.event_hash}.json`;
    await writeDurableJson(path.join(ledgerDir, filename), event);
    return event;
  } finally {
    await lock.release();
  }
}

export async function verifyLedger(ledgerDirInput) {
  const ledgerDir = path.resolve(ledgerDirInput);
  let names;
  try {
    names = await fs.readdir(ledgerDir);
  } catch (error) {
    if (error.code === "ENOENT") return { valid: true, errors: [], events: [] };
    throw error;
  }
  const errors = [];
  const temporary = names.filter((name) => name.endsWith(".tmp"));
  if (temporary.length) errors.push(`orphan temporary ledger files: ${temporary.sort().join(", ")}`);
  const jsonNames = names.filter((name) => name.endsWith(".json")).sort();
  const events = [];
  let previousHash = ZERO_HASH;
  let campaignId = null;
  let ledgerKind = null;
  const eventIds = new Set();
  const segmentMonotonic = new Map();
  for (let index = 0; index < jsonNames.length; index += 1) {
    const name = jsonNames[index];
    const match = EVENT_FILE_PATTERN.exec(name);
    if (!match) {
      errors.push(`unexpected JSON file in ledger: ${name}`);
      continue;
    }
    let event;
    try {
      event = JSON.parse(await fs.readFile(path.join(ledgerDir, name), "utf8"));
    } catch (error) {
      errors.push(`cannot parse ${name}: ${error.message}`);
      continue;
    }
    const expectedSequence = index + 1;
    if (event.schema_version !== 1) errors.push(`unsupported event schema in ${name}`);
    if (typeof event.event_type !== "string" || !event.event_type) errors.push(`missing event type in ${name}`);
    if (typeof event.event_id !== "string" || !event.event_id) errors.push(`missing event id in ${name}`);
    if (!Number.isFinite(Date.parse(event.wall_time_utc))) errors.push(`invalid wall clock in ${name}`);
    if (typeof event.clock?.segment_id !== "string" || !event.clock.segment_id || !/^\d+$/.test(event.clock?.mono_ns || "")) {
      errors.push(`invalid monotonic clock in ${name}`);
    } else {
      const monotonic = BigInt(event.clock.mono_ns);
      const previousMonotonic = segmentMonotonic.get(event.clock.segment_id);
      if (previousMonotonic !== undefined && monotonic < previousMonotonic) errors.push(`monotonic clock moved backward in ${name}`);
      segmentMonotonic.set(event.clock.segment_id, monotonic);
    }
    if (event.seq !== expectedSequence || Number(match[1]) !== expectedSequence) errors.push(`sequence mismatch in ${name}`);
    if (event.prev_event_hash !== previousHash) errors.push(`previous hash mismatch in ${name}`);
    if (event.event_hash !== match[2]) errors.push(`filename hash mismatch in ${name}`);
    const { event_hash: recordedHash, ...body } = event;
    const computedHash = sha256Value(body);
    if (recordedHash !== computedHash) errors.push(`event hash mismatch in ${name}`);
    if (!HASH_PATTERN.test(recordedHash || "")) errors.push(`invalid event hash in ${name}`);
    if (eventIds.has(event.event_id)) errors.push(`duplicate event id ${event.event_id}`);
    eventIds.add(event.event_id);
    campaignId ??= event.campaign_id;
    ledgerKind ??= event.ledger_kind;
    if (event.campaign_id !== campaignId) errors.push(`campaign id changed in ${name}`);
    if (event.ledger_kind !== ledgerKind) errors.push(`ledger kind changed in ${name}`);
    previousHash = recordedHash;
    events.push(event);
  }
  return { valid: errors.length === 0, errors, events, head_hash: events.at(-1)?.event_hash || ZERO_HASH };
}

export function redactSensitiveText(input) {
  if (typeof input !== "string") return input;
  return input
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/\b(token|api[_-]?key|secret|password|aws_secret_access_key)\b(\s*[:=]\s*)(["'])(.*?)\3/gi, "$1$2$3[REDACTED]$3")
    .replace(/\b(token|api[_-]?key|secret|password|aws_secret_access_key)\b(\s*[:=]\s*)[^\s"']+/gi, "$1$2[REDACTED]")
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]");
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    const redacted = redactSensitiveText(value);
    return redacted.length > 65_536 ? `${redacted.slice(0, 65_536)}\n[TRUNCATED]` : redacted;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /^(authorization|token|api[_-]?key|secret|password|aws_secret_access_key)$/i.test(key) ? "[REDACTED]" : sanitizeValue(item),
    ]));
  }
  return value;
}

export function serializeRedactedCodexJsonl(events) {
  if (!Array.isArray(events)) throw new TypeError("Codex events must be an array");
  if (events.length === 0) return "";
  return events.map((event) => JSON.stringify(sanitizeValue(event))).join("\n") + "\n";
}

function normalizedUsage(usage, previous, errors) {
  if (!usage) return null;
  const fields = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"];
  const result = {};
  for (const field of fields) {
    const total = Number(usage[field] || 0);
    const baseline = previous ? Number(previous[field] || 0) : 0;
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(baseline) || baseline < 0) {
      errors.push(`invalid usage counter ${field}`);
      return null;
    }
    if (total < baseline) {
      errors.push(`cumulative usage counter moved backward for ${field}`);
      return null;
    }
    result[field] = total - baseline;
  }
  result.uncached_input_tokens = Math.max(result.input_tokens - result.cached_input_tokens, 0);
  return {
    input_tokens: result.input_tokens,
    cached_input_tokens: result.cached_input_tokens,
    uncached_input_tokens: result.uncached_input_tokens,
    output_tokens: result.output_tokens,
    reasoning_output_tokens: result.reasoning_output_tokens,
  };
}

export function parseCodexJsonl(input) {
  const errors = [];
  const events = [];
  const unknownEvents = [];
  const items = [];
  const toolOutcomes = [];
  let threadId = null;
  let turnOrdinal = 0;
  let terminalUsage = null;
  let sawTurnCompleted = false;
  let sawTurnFailed = false;
  const lines = String(input.stdout || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      errors.push(`invalid Codex JSONL at line ${index + 1}: ${error.message}`);
      continue;
    }
    const event = sanitizeValue(raw);
    events.push(event);
    if (event.type === "thread.started") threadId = event.thread_id || threadId;
    else if (event.type === "turn.started") turnOrdinal += 1;
    else if (["item.started", "item.updated", "item.completed"].includes(event.type)) {
      const item = event.item || {};
      const normalized = {
        event_type: event.type,
        turn_ordinal: Math.max(turnOrdinal, 1),
        composite_id: `${input.attempt_id}:${Math.max(turnOrdinal, 1)}:${item.id || "missing"}`,
        ...item,
      };
      items.push(normalized);
      if (event.type === "item.completed" && ["command_execution", "mcp_tool_call", "collab_tool_call", "file_change"].includes(item.type)) {
        toolOutcomes.push({
          composite_id: normalized.composite_id,
          type: item.type,
          outcome: item.status || (item.exit_code === 0 ? "completed" : "failed"),
          exit_code: item.exit_code ?? null,
        });
      }
    } else if (event.type === "turn.completed") {
      sawTurnCompleted = true;
      terminalUsage = event.usage || null;
    } else if (event.type === "turn.failed") sawTurnFailed = true;
    else if (event.type !== "error") unknownEvents.push(event);
  }

  let classification;
  if (input.timed_out) classification = "timeout";
  else if (errors.length) classification = "instrumentation_failure";
  else if (sawTurnFailed) classification = "turn_failed";
  else if (sawTurnCompleted && input.exit_code === 0) classification = "success";
  else if (sawTurnCompleted) classification = "completed_but_process_failed";
  else if (input.exit_code !== 0) classification = "interrupted_or_process_failed";
  else classification = "protocol_incomplete";
  if (classification === "protocol_incomplete") errors.push("Codex JSONL ended without a terminal event");
  const usage = normalizedUsage(terminalUsage, input.previous_terminal_usage || null, errors);
  if (errors.length && !["timeout", "protocol_incomplete"].includes(classification)) classification = "instrumentation_failure";
  return {
    schema_version: 1,
    attempt_id: input.attempt_id,
    valid: errors.length === 0 && classification !== "protocol_incomplete",
    errors,
    thread_id: threadId,
    terminal: {
      classification,
      exit_code: input.exit_code ?? null,
      timed_out: Boolean(input.timed_out),
      signal: input.signal || null,
    },
    usage,
    events,
    items,
    tool_outcomes: toolOutcomes,
    unknown_events: unknownEvents,
    stderr: redactSensitiveText(String(input.stderr || "").slice(0, 65_536)),
  };
}

function coalesceIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
  const merged = [];
  let [start, end] = sorted[0];
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) {
      if (nextEnd > end) end = nextEnd;
    } else {
      merged.push([start, end]);
      [start, end] = [nextStart, nextEnd];
    }
  }
  merged.push([start, end]);
  return merged;
}

function intervalDuration(intervals) {
  return intervals.reduce((total, [start, end]) => total + end - start, 0n);
}

function subtractIntervals(sourceIntervals, coveringIntervals) {
  const result = [];
  const sources = coalesceIntervals(sourceIntervals);
  const covers = coalesceIntervals(coveringIntervals);
  for (const [sourceStart, sourceEnd] of sources) {
    let cursor = sourceStart;
    for (const [coverStart, coverEnd] of covers) {
      if (coverEnd <= cursor) continue;
      if (coverStart >= sourceEnd) break;
      if (coverStart > cursor) result.push([cursor, coverStart < sourceEnd ? coverStart : sourceEnd]);
      if (coverEnd > cursor) cursor = coverEnd;
      if (cursor >= sourceEnd) break;
    }
    if (cursor < sourceEnd) result.push([cursor, sourceEnd]);
  }
  return result;
}

export function replayCampaignAccounting(ledgers, options = {}) {
  const maxCredibleGapNs = BigInt(options.max_credible_gap_ns || "60000000000");
  const activeIntervals = [];
  const supportIntervals = [];
  const idleIntervals = [];
  const unknownIntervals = [];
  const paddingIntervals = [];
  let productiveWorkerNs = 0n;
  let supportUnmappedNs = 0n;
  let idleUnmappedNs = 0n;
  let unknownUnmappedNs = 0n;
  let paddingUnmappedNs = 0n;
  for (const events of ledgers) {
    for (let index = 0; index + 1 < events.length; index += 1) {
      const current = events[index];
      const next = events[index + 1];
      if (!current.clock || !next.clock || current.clock.segment_id !== next.clock.segment_id) continue;
      if (!/^\d+$/.test(current.clock.mono_ns || "") || !/^\d+$/.test(next.clock.mono_ns || "")) continue;
      const startMono = BigInt(current.clock.mono_ns);
      const endMono = BigInt(next.clock.mono_ns);
      if (endMono <= startMono) continue;
      const delta = endMono - startMono;
      const wallStartMs = Date.parse(current.wall_time_utc);
      const mappedInterval = Number.isFinite(wallStartMs)
        ? [BigInt(wallStartMs) * 1_000_000n, BigInt(wallStartMs) * 1_000_000n + delta]
        : null;
      if (delta > maxCredibleGapNs) {
        if (mappedInterval) unknownIntervals.push(mappedInterval);
        else unknownUnmappedNs += delta;
        continue;
      }
      const state = current.state_after;
      if (CORE_ACTIVE_STATES.has(state)) {
        productiveWorkerNs += delta;
        if (mappedInterval) activeIntervals.push(mappedInterval);
        else unknownUnmappedNs += delta;
      } else if (SUPPORT_STATES.has(state)) {
        if (mappedInterval) supportIntervals.push(mappedInterval);
        else supportUnmappedNs += delta;
      } else if (IDLE_STATES.has(state)) {
        if (mappedInterval) idleIntervals.push(mappedInterval);
        else idleUnmappedNs += delta;
      } else if (PADDING_STATES.has(state)) {
        if (mappedInterval) paddingIntervals.push(mappedInterval);
        else paddingUnmappedNs += delta;
      }
    }
  }
  const active = coalesceIntervals(activeIntervals);
  const knownCoverage = coalesceIntervals([...activeIntervals, ...supportIntervals, ...idleIntervals]);
  const support = subtractIntervals(supportIntervals, active);
  const idle = subtractIntervals(idleIntervals, [...activeIntervals, ...supportIntervals]);
  const unknown = subtractIntervals(unknownIntervals, knownCoverage);
  return {
    eligible_core_active_ns: String(intervalDuration(active)),
    productive_worker_ns: String(productiveWorkerNs),
    support_overhead_ns: String(intervalDuration(support) + supportUnmappedNs),
    idle_ns: String(intervalDuration(idle) + idleUnmappedNs),
    unknown_gap_ns: String(intervalDuration(unknown) + unknownUnmappedNs),
    invalid_padding_ns: String(intervalDuration(coalesceIntervals(paddingIntervals)) + paddingUnmappedNs),
  };
}
