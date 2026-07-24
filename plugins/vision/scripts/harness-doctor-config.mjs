import fs from "node:fs/promises";
import path from "node:path";
import { exists, portablePath } from "./harness-doctor-utils.mjs";

function tomlString(raw) {
  const value = raw.trim();
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

export async function readCodexConfig(codexHome) {
  const file = path.join(codexHome, "config.toml");
  const empty = { file: portablePath(file), status: "missing", model: null, reasoningEffort: null, plugins: {}, skills: {}, marketplaces: {} };
  if (!(await exists(file))) return empty;
  let content;
  try { content = await fs.readFile(file, "utf8"); } catch { return { ...empty, status: "unreadable" }; }
  const result = { ...empty, status: "read" };
  let section = { kind: "root", id: null };
  let skillEntry = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[skills.config]]") {
      skillEntry = { path: null, enabled: true };
      section = { kind: "skill", id: null };
      continue;
    }
    const plugin = line.match(/^\[plugins\."([^"]+)"\]$/);
    if (plugin) { section = { kind: "plugin", id: plugin[1] }; result.plugins[plugin[1]] ??= {}; continue; }
    const marketplace = line.match(/^\[marketplaces\.([^\]]+)\]$/);
    if (marketplace) { section = { kind: "marketplace", id: marketplace[1] }; result.marketplaces[marketplace[1]] ??= {}; continue; }
    if (line.startsWith("[")) { section = { kind: "other", id: null }; continue; }
    const assignment = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = rawValue === "true" ? true : rawValue === "false" ? false : tomlString(rawValue);
    if (section.kind === "root" && key === "model") result.model = value;
    else if (section.kind === "root" && key === "model_reasoning_effort") result.reasoningEffort = value;
    else if (section.kind === "plugin" && key === "enabled") result.plugins[section.id].enabled = value;
    else if (section.kind === "marketplace" && key === "source") result.marketplaces[section.id].source = value;
    else if (section.kind === "skill" && skillEntry) {
      if (key === "path") skillEntry.path = portablePath(path.isAbsolute(value) ? value : path.resolve(codexHome, value));
      if (key === "enabled") skillEntry.enabled = value;
      if (skillEntry.path) result.skills[skillEntry.path] = { enabled: skillEntry.enabled };
    }
  }
  return result;
}
