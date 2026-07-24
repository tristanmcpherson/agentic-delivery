import fs from "node:fs/promises";
import path from "node:path";
import {
  contextFor,
  exists,
  finding,
  isInside,
  portablePath,
  readJson,
  redactLocator,
  sha256File,
  sortRecords,
  walk,
} from "./harness-doctor-utils.mjs";

function cacheIdentity(codexHome, pluginRoot) {
  const relative = path.relative(path.join(codexHome, "plugins", "cache"), pluginRoot);
  const parts = relative.split(path.sep);
  if (parts.length !== 3 || relative.startsWith("..")) return null;
  return { marketplace: parts[0], name: parts[1], version: parts[2] };
}

async function declaredPaths(pluginRoot, manifest) {
  const declarations = [];
  for (const [kind, value] of [["skills", manifest.skills], ["mcp", manifest.mcpServers], ["app", manifest.apps], ["hooks", manifest.hooks]]) {
    if (typeof value !== "string") continue;
    const target = path.resolve(pluginRoot, value);
    const present = await exists(target);
    let contained = isInside(pluginRoot, target);
    if (contained && present) {
      try {
        contained = isInside(await fs.realpath(pluginRoot), await fs.realpath(target));
      } catch {
        contained = false;
      }
    }
    declarations.push({ kind, declared: value, target, contained, present });
  }
  return declarations;
}

function absoluteCommands(value, output = []) {
  if (Array.isArray(value)) for (const item of value) absoluteCommands(item, output);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "command" && typeof item === "string" && path.isAbsolute(item)) output.push(item);
      else absoluteCommands(item, output);
    }
  }
  return output;
}

async function pluginRecord(input) {
  const context = contextFor(input.contextRoot, input.manifestFile);
  const parsed = await readJson(input.manifestFile);
  if (!parsed.value) return {
    record: {
      path: portablePath(input.manifestFile), root: portablePath(input.pluginRoot), scope: input.scope,
      context, installation: input.installation,
      status: "malformed", name: null, version: null, enabled: null, declarations: [],
    },
    findings: context === "historical" ? [] : [finding({
      code: "malformed-plugin-manifest", category: "plugin", recommendation: "update",
      rationale: `Plugin manifest cannot be parsed: ${parsed.error}.`, evidence: [portablePath(input.manifestFile)],
      ownership: input.installation === "installed" ? "package-owned" : "unowned",
    })],
  };
  const manifest = parsed.value;
  const identity = input.scope === "user" ? cacheIdentity(input.codexHome, input.pluginRoot) : null;
  const pluginId = identity ? `${identity.name}@${identity.marketplace}` : null;
  const declarations = await declaredPaths(input.pluginRoot, manifest);
  const findings = [];
  for (const declaration of declarations.filter((item) => context === "operational" && (!item.contained || !item.present))) findings.push(finding({
    code: declaration.contained ? "missing-declared-component" : "declared-component-path-escape",
    category: "plugin",
    recommendation: declaration.contained ? "update" : "manual-review",
    rationale: declaration.contained
      ? `Declared ${declaration.kind} component is missing.`
      : `Declared ${declaration.kind} component escapes the plugin root.`,
    evidence: [portablePath(input.manifestFile), portablePath(declaration.target)],
    ownership: input.installation === "installed" ? "package-owned" : "unowned",
  }));
  const mcp = declarations.find((item) => item.kind === "mcp" && item.present && item.contained);
  let mcpStatus = "not-declared";
  if (mcp) {
    const payload = await readJson(mcp.target);
    mcpStatus = payload.status;
    if (!payload.value && context === "operational") findings.push(finding({
      code: "malformed-mcp-wiring", category: "plugin", recommendation: "update",
      rationale: "A declared MCP wiring file is not valid JSON.",
      evidence: [portablePath(input.manifestFile), portablePath(mcp.target)],
      ownership: input.installation === "installed" ? "package-owned" : "unowned",
    }));
    if (payload.value) for (const command of absoluteCommands(payload.value)) {
      if (!(await exists(command))) findings.push(finding({
        code: "missing-materialized-target", category: "plugin", recommendation: "update",
        rationale: "An absolute materialized MCP command target is missing.",
        evidence: [portablePath(mcp.target), portablePath(command)], ownership: "package-owned",
      }));
    }
  }
  const conventionalHooks = path.join(input.pluginRoot, "hooks", "hooks.json");
  let conventionalHooksStatus = "absent";
  if (await exists(conventionalHooks)) {
    const payload = await readJson(conventionalHooks);
    conventionalHooksStatus = payload.status;
    if (!payload.value && context === "operational") findings.push(finding({
      code: "malformed-hook-wiring", category: "plugin", recommendation: "update",
      rationale: "A conventional hook wiring file is not valid JSON.",
      evidence: [portablePath(input.manifestFile), portablePath(conventionalHooks)],
      ownership: input.installation === "installed" ? "package-owned" : "unowned",
    }));
  }
  return {
    record: {
      path: portablePath(input.manifestFile), root: portablePath(input.pluginRoot), scope: input.scope,
      context, installation: input.installation,
      marketplace: identity?.marketplace || null, name: manifest.name || null,
      id: pluginId,
      version: manifest.version || identity?.version || null, enabled: pluginId ? input.config.plugins[pluginId]?.enabled ?? null : null,
      status: manifest.name ? "valid" : "malformed",
      sha256: await sha256File(input.manifestFile), modified: null,
      declarations: declarations.map((item) => ({ ...item, target: portablePath(item.target) })),
      wiring: {
        mcp: mcpStatus,
        conventional_hooks: { path: portablePath(conventionalHooks), status: conventionalHooksStatus, declared: declarations.some((item) => item.kind === "hooks") },
      },
    },
    findings,
  };
}

async function manifestInputs(options) {
  const inputs = [];
  if (options.scope !== "user") {
    const manifests = await walk(options.root, (file, kind) => kind === "file" && portablePath(file).endsWith("/.codex-plugin/plugin.json"));
    for (const item of manifests) inputs.push({
      manifestFile: item.path, pluginRoot: path.dirname(path.dirname(item.path)), scope: "project",
      contextRoot: options.root, installation: "source", config: options.config, codexHome: options.codexHome,
    });
  }
  if (options.scope !== "project" && options.codexHome) {
    const cache = path.join(options.codexHome, "plugins", "cache");
    const manifests = await walk(cache, (file, kind) => kind === "file" && portablePath(file).endsWith("/.codex-plugin/plugin.json"));
    for (const item of manifests) {
      const pluginRoot = path.dirname(path.dirname(item.path));
      if (!cacheIdentity(options.codexHome, pluginRoot)) continue;
      inputs.push({
        manifestFile: item.path, pluginRoot, scope: "user",
        contextRoot: options.codexHome, installation: "installed", config: options.config, codexHome: options.codexHome,
      });
    }
  }
  return inputs;
}

async function marketplaceFiles(options) {
  const files = [];
  if (options.scope !== "user") {
    for (const file of [path.join(options.root, ".agents", "plugins", "marketplace.json"), path.join(options.root, "marketplace.json")]) {
      if (await exists(file)) files.push({ file, scope: "project", root: options.root });
    }
  }
  if (options.scope !== "project") for (const item of Object.values(options.config.marketplaces)) {
    if (typeof item.source !== "string") continue;
    const file = path.join(item.source, ".agents", "plugins", "marketplace.json");
    if (await exists(file)) files.push({ file, scope: "user", root: item.source });
  }
  return files;
}

export async function inventoryPlugins(options) {
  const plugins = [];
  const findings = [];
  for (const input of await manifestInputs(options)) {
    const result = await pluginRecord(input);
    plugins.push(result.record);
    findings.push(...result.findings);
  }
  const marketplaces = [];
  for (const input of await marketplaceFiles(options)) {
    const parsed = await readJson(input.file);
    const entries = Array.isArray(parsed.value?.plugins) ? parsed.value.plugins : [];
    marketplaces.push({
      path: portablePath(input.file), scope: input.scope, status: parsed.status,
      name: parsed.value?.name || null,
      plugins: entries.map((entry) => ({ name: entry.name || null, source: redactLocator(entry.source?.source || null), path: redactLocator(entry.source?.path || null) })),
    });
    if (!parsed.value) findings.push(finding({
      code: "malformed-marketplace-catalog", category: "marketplace", status: "unknown", severity: "info",
      recommendation: "manual-review", rationale: "A marketplace catalog could not be parsed; availability remains unknown.",
      evidence: [portablePath(input.file)], ownership: "external", confirmationRequired: false,
    }));
  }
  if (options.scope !== "project") {
    for (const [id, configured] of Object.entries(options.config.marketplaces)) {
      if (typeof configured.source !== "string") continue;
      const remote = /^[a-z][a-z0-9+.-]*:\/\//i.test(configured.source);
      const expected = remote ? redactLocator(configured.source) : portablePath(path.join(configured.source, ".agents", "plugins", "marketplace.json"));
      const match = marketplaces.find((item) => item.path === expected);
      if (match) match.configured_as = id;
      else marketplaces.push({
        path: expected, scope: "user", status: remote ? "configured-remote-unqueried" : "missing",
        name: id, configured_as: id, plugins: [],
      });
    }
    for (const [id, configured] of Object.entries(options.config.plugins)) {
      if (plugins.some((item) => item.id === id)) continue;
      const separator = id.lastIndexOf("@");
      const name = separator > 0 ? id.slice(0, separator) : id;
      const marketplace = separator > 0 ? id.slice(separator + 1) : null;
      plugins.push({
        path: options.config.file, root: null, scope: "user", context: "operational",
        installation: "configured", marketplace, name, id, version: null,
        enabled: configured.enabled ?? null, status: "not-installed", sha256: null, modified: null,
        declarations: [], wiring: { mcp: "unknown", conventional_hooks: null },
      });
      if (configured.enabled === true) findings.push(finding({
        code: "enabled-plugin-not-installed", category: "plugin", status: "unknown", severity: "info", confidence: "medium",
        recommendation: "manual-review",
        rationale: "A plugin is enabled in configuration but no installed cache payload was found; loader state remains unknown offline.",
        evidence: [options.config.file, id], ownership: "external", confirmationRequired: false,
      }));
    }
  }
  const installedGroups = new Map();
  for (const item of plugins.filter((record) => record.installation === "installed" && record.name)) {
    const key = `${item.marketplace}/${item.name}`;
    installedGroups.set(key, [...(installedGroups.get(key) || []), item]);
  }
  for (const [key, matches] of installedGroups) if (matches.length > 1) findings.push(finding({
    code: "multiple-installed-plugin-versions", category: "plugin", recommendation: "manual-review",
    rationale: `Multiple installed plugin payloads exist for ${key}; ownership and active version must be confirmed before pruning.`,
    evidence: matches.map((item) => item.path), ownership: "package-owned",
  }));
  const pluginRoots = plugins.flatMap((item) => item.declarations
    .filter((declaration) => declaration.kind === "skills" && declaration.present && declaration.contained)
    .map((declaration) => ({
      root: item.root,
      skillsRoot: declaration.target,
      scope: item.scope,
      providerId: item.id,
      providerEnabled: item.enabled,
      providerInstallation: item.installation,
      providerVersion: item.version,
    })));
  return { plugins: sortRecords(plugins), marketplaces: sortRecords(marketplaces), findings: sortRecords(findings), pluginRoots };
}
