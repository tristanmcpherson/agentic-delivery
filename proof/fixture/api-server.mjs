import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import process from "node:process";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const port = Number(arg("port", "46201"));
const mode = arg("mode", "healthy");
const marker = arg("marker", mode === "healthy" ? "local" : "broken-dev");
const allowOrigin = arg("allow-origin", "*");
const deploymentId = arg("deployment-id", `${marker}-fixture-v1`);
const correlations = new Map();

function responseHash(body) {
  return createHash("sha256").update(body).digest("hex");
}

const server = http.createServer((request, response) => {
  response.setHeader("access-control-allow-origin", allowOrigin);
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, x-agentic-run-id");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-agentic-environment", marker);
  response.setHeader("x-agentic-deployment-id", deploymentId);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === "/health") {
    response.end(JSON.stringify({ status: "ok", environment: marker, mode, deploymentId }));
    return;
  }
  if (request.url?.startsWith("/__agentic/correlation")) {
    const runId = new URL(request.url, `http://127.0.0.1:${port}`).searchParams.get("run_id");
    const record = correlations.get(runId);
    if (!record) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "correlation not found" }));
      return;
    }
    response.end(JSON.stringify(record));
    return;
  }
  if (request.url === "/api/profile") {
    const runId = String(request.headers["x-agentic-run-id"] || "missing");
    const canary = runId.slice(0, 8);
    const requestId = randomBytes(8).toString("hex");
    const body = JSON.stringify(mode === "broken" ? { name: `Avery ${canary}`, role: "Engineer" } : { displayName: `Avery ${canary}`, role: "Engineer" });
    const sha256 = responseHash(body);
    response.setHeader("x-agentic-run-id", runId);
    response.setHeader("x-agentic-request-id", requestId);
    response.setHeader("x-agentic-response-sha256", sha256);
    correlations.set(runId, { run_id: runId, request_id: requestId, deployment_id: deploymentId, response_sha256: sha256, path: request.url, method: request.method });
    response.end(body);
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "127.0.0.1", () => console.log(`fixture API ${mode} listening on http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
