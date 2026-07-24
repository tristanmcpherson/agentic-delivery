import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_NAME = /^[a-z0-9][a-z0-9._-]*\.json$/i;

export async function loadPublicConfig(options) {
  if (typeof options?.root !== "string" || typeof options?.name !== "string") throw new TypeError("root and name are required");
  if (!CONFIG_NAME.test(options.name) || path.basename(options.name) !== options.name || path.isAbsolute(options.name)) {
    throw new Error("Invalid configuration name");
  }
  const root = await fs.realpath(options.root);
  const file = path.join(root, options.name);
  const realFile = await fs.realpath(file);
  if (path.dirname(realFile) !== root) throw new Error("Invalid configuration name: file escapes configuration root");
  const parsed = JSON.parse(await fs.readFile(realFile, "utf8"));
  if (typeof parsed.apiBaseUrl !== "string") throw new Error("apiBaseUrl is required");
  const api = new URL(parsed.apiBaseUrl);
  const localHttp = api.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(api.hostname);
  if (api.protocol !== "https:" && !localHttp) throw new Error("apiBaseUrl must use https outside localhost");
  if (!parsed.features || typeof parsed.features !== "object" || Array.isArray(parsed.features)) throw new Error("features must be an object");
  const features = Object.fromEntries(Object.entries(parsed.features).filter(([, value]) => typeof value === "boolean"));
  return { apiBaseUrl: api.href.replace(/\/$/, ""), features };
}
