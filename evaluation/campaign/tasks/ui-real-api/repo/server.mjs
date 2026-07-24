import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

export function createApplicationServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/orders") {
      const nonce = url.searchParams.get("nonce");
      if (!nonce) return sendJson(response, 400, { error: "nonce is required" });
      return sendJson(response, 200, {
        request_nonce: nonce,
        orders: [
          { order_id: "A-100", total_cents: 1234 },
          { order_id: "B-200", total_cents: 5099 },
        ],
      });
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!["index.html", "app.js"].includes(relative)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    const body = await fs.readFile(path.join(publicRoot, relative));
    response.writeHead(200, {
      "content-type": relative.endsWith(".js") ? "text/javascript" : "text/html",
      "cache-control": "no-store",
    });
    response.end(body);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createApplicationServer();
  server.listen(Number(process.env.PORT || 3000), "127.0.0.1", () => console.log(`listening on ${server.address().port}`));
}
