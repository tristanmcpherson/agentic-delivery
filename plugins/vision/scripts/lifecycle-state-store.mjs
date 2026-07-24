import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MUTATION_LOCK_TTL_MS = 30_000;

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read JSON ${filePath}: ${error.message}`);
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function removeExpiredLock(lockFile, nowMs) {
  let record;
  try {
    record = await readJson(lockFile);
  } catch {
    return false;
  }
  if (!record || Date.parse(record.expires_at) > nowMs) return false;
  try {
    await fs.rm(lockFile);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

async function acquireMutationLock(lockFile, allowExpiredRecovery = true) {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  const nowMs = Date.now();
  let handle;
  try {
    handle = await fs.open(lockFile, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (allowExpiredRecovery && await removeExpiredLock(lockFile, nowMs)) {
      return acquireMutationLock(lockFile, false);
    }
    throw new Error("Concurrent lifecycle writer holds the mutation lock.");
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      schema_version: 1,
      pid: process.pid,
      acquired_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + MUTATION_LOCK_TTL_MS).toISOString(),
    })}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.rm(lockFile, { force: true });
    throw error;
  }
  return async () => {
    await handle.close();
    await fs.rm(lockFile, { force: true });
  };
}

export async function withLifecycleStateLock(stateFile, mutation) {
  const lockFile = `${stateFile}.lock`;
  const release = await acquireMutationLock(lockFile);
  try {
    const current = await readJson(stateFile);
    const next = await mutation(current);
    if (next !== undefined) await writeJsonAtomic(stateFile, next);
    return next;
  } finally {
    await release();
  }
}
