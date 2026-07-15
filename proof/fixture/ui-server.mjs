import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const port = Number(arg("port", "46200"));
const apiOrigin = arg("api-origin", "http://127.0.0.1:46201");
const directory = path.dirname(fileURLToPath(import.meta.url));

function html() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Environment Truth Lab</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #eef2ff; background: radial-gradient(circle at 15% 10%, #244766 0, transparent 32%), radial-gradient(circle at 90% 85%, #49336f 0, transparent 34%), #09111f; }
    main { width: min(880px, calc(100% - 40px)); display: grid; grid-template-columns: 1.25fr .75fr; gap: 24px; }
    .panel { border: 1px solid rgba(167, 196, 255, .2); border-radius: 24px; background: rgba(10, 19, 35, .94); box-shadow: 0 28px 80px rgba(0,0,0,.36); }
    .hero { padding: 44px; }
    .eyebrow { color: #9bc7ff; font-size: 12px; font-weight: 750; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 14px 0 12px; font-size: clamp(36px, 5vw, 62px); line-height: .98; letter-spacing: -.045em; }
    .lede { color: #b9c6dc; font-size: 17px; line-height: 1.55; max-width: 560px; }
    button { margin-top: 24px; border: 0; border-radius: 999px; padding: 13px 20px; color: #08101d; background: linear-gradient(135deg, #b9e6ff, #c5b8ff); font-weight: 800; cursor: pointer; box-shadow: 0 10px 30px rgba(144, 194, 255, .24); }
    button:hover { transform: translateY(-1px); }
    .result { padding: 26px; display: flex; flex-direction: column; justify-content: space-between; min-height: 330px; }
    .status { display: inline-flex; width: fit-content; align-items: center; gap: 8px; border-radius: 999px; padding: 7px 11px; color: #9bb0cd; background: rgba(144, 165, 196, .1); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #8190a5; }
    .ready .dot { background: #67e8a5; box-shadow: 0 0 18px #67e8a5; }
    .error .dot { background: #ff7b91; box-shadow: 0 0 18px #ff7b91; }
    .profile { margin: 28px 0; }
    .avatar { width: 68px; height: 68px; display: grid; place-items: center; border-radius: 22px; color: #1b2140; background: linear-gradient(135deg, #6ee7f5, #c4b5fd); font-size: 24px; font-weight: 900; }
    h2 { margin: 16px 0 4px; font-size: 27px; }
    .role, .detail { color: #9bacbe; }
    .detail { border-top: 1px solid rgba(167,196,255,.13); padding-top: 18px; font-size: 13px; overflow-wrap: anywhere; }
    @media (max-width: 720px) { main { grid-template-columns: 1fr; margin: 20px 0; } .hero { padding: 30px; } }
  </style>
</head>
<body>
  <main>
    <section class="panel hero">
      <div class="eyebrow">Vision delivery proof</div>
      <h1>The browser should meet the real API.</h1>
      <p class="lede">Mocked UI states are useful. This journey proves whether the application actually understands the service response in the selected environment.</p>
      <button type="button" id="load-profile">Load verified profile</button>
    </section>
    <aside class="panel result" aria-live="polite">
      <div>
        <div class="status" data-testid="status"><span class="dot"></span><span>Waiting</span></div>
        <div class="profile">
          <div class="avatar" data-testid="avatar">?</div>
          <h2 data-testid="display-name">No profile loaded</h2>
          <div class="role" data-testid="role">Start the journey to contact the API.</div>
        </div>
      </div>
      <div class="detail">API target<br><strong data-testid="api-origin">${apiOrigin}</strong></div>
    </aside>
  </main>
  <script type="module">
    import { parseProfile } from "/profile.mjs";
    const button = document.querySelector("#load-profile");
    const status = document.querySelector('[data-testid="status"]');
    const displayName = document.querySelector('[data-testid="display-name"]');
    const role = document.querySelector('[data-testid="role"]');
    const avatar = document.querySelector('[data-testid="avatar"]');
    button.addEventListener("click", async () => {
      status.className = "status";
      status.lastElementChild.textContent = "Loading";
      try {
        const response = await fetch(${JSON.stringify(apiOrigin)} + "/api/profile");
        if (!response.ok) throw new Error("Profile request failed with " + response.status);
        const profile = parseProfile(await response.json());
        displayName.textContent = profile.displayName;
        role.textContent = profile.role;
        avatar.textContent = profile.displayName.split(/\\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
        status.className = "status ready";
        status.lastElementChild.textContent = "Ready";
      } catch (error) {
        displayName.textContent = "Profile unavailable";
        role.textContent = error.message;
        avatar.textContent = "!";
        status.className = "status error";
        status.lastElementChild.textContent = "Contract error";
        console.error(error);
      }
    });
  </script>
</body>
</html>`;
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/health") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok", apiOrigin }));
    return;
  }
  if (request.url === "/profile.mjs") {
    response.setHeader("content-type", "text/javascript; charset=utf-8");
    response.end(await fs.readFile(path.join(directory, "profile.mjs"), "utf8"));
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html());
});

server.listen(port, "127.0.0.1", () => console.log(`fixture UI listening on http://127.0.0.1:${port}, API ${apiOrigin}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
