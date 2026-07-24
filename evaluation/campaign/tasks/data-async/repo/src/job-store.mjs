import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

export async function initializeJobFile(file, ids) {
  await fs.writeFile(file, `${JSON.stringify({ jobs: ids.map((id) => ({ id, status: "ready", generation: 0, lease: null })) }, null, 2)}\n`, "utf8");
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
    const state = await this.read();
    const now = this.now();
    const job = state.jobs.find((candidate) => candidate.status === "ready" || (candidate.status === "leased" && candidate.lease.expires_at <= now));
    if (!job) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
    job.status = "leased";
    job.generation += 1;
    job.lease = {
      worker_id: workerId,
      token: randomUUID(),
      expires_at: now + Number(options.lease_ms || 30_000),
    };
    await fs.writeFile(this.file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return { id: job.id, generation: job.generation, ...job.lease };
  }

  async complete(jobId, token) {
    const state = await this.read();
    const job = state.jobs.find((candidate) => candidate.id === jobId);
    if (!job || job.status !== "leased") return false;
    job.status = "done";
    job.lease = null;
    await fs.writeFile(this.file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return true;
  }
}
