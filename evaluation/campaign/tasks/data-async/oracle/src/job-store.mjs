import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, file);
}

async function withLock(file, operation) {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 500; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lock, "wx", 0o600);
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error.code)) throw error;
      await wait(2);
      continue;
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      for (let removal = 0; removal < 100; removal += 1) {
        try {
          await fs.rm(lock, { force: true });
          break;
        } catch (error) {
          if (!["EPERM", "EACCES"].includes(error.code) || removal === 99) throw error;
          await wait(2);
        }
      }
    }
  }
  throw new Error("Timed out acquiring job-store lock");
}

export async function initializeJobFile(file, ids) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeAtomic(file, { jobs: ids.map((id) => ({ id, status: "ready", generation: 0, lease: null })) });
}

export class JobStore {
  constructor(file, options = {}) {
    this.file = file;
    this.now = options.now || Date.now;
  }

  async read() {
    return JSON.parse(await fs.readFile(this.file, "utf8"));
  }

  async claim(workerId, options = {}) {
    return withLock(this.file, async () => {
      const state = await this.read();
      const now = this.now();
      const job = state.jobs.find((candidate) => candidate.status === "ready" || (candidate.status === "leased" && candidate.lease.expires_at <= now));
      if (!job) return null;
      job.status = "leased";
      job.generation += 1;
      job.lease = {
        worker_id: workerId,
        token: randomUUID(),
        expires_at: now + Number(options.lease_ms || 30_000),
      };
      await writeAtomic(this.file, state);
      return { id: job.id, generation: job.generation, ...job.lease };
    });
  }

  async complete(jobId, token) {
    return withLock(this.file, async () => {
      const state = await this.read();
      const job = state.jobs.find((candidate) => candidate.id === jobId);
      if (!job || job.status !== "leased" || job.lease?.token !== token) return false;
      job.status = "done";
      job.lease = null;
      await writeAtomic(this.file, state);
      return true;
    });
  }
}
