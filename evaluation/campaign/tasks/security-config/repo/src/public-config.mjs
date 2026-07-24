import fs from "node:fs/promises";
import path from "node:path";

export async function loadPublicConfig(options) {
  const file = path.resolve(options.root, options.name);
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  return {
    ...parsed,
    adminToken: options.env?.ADMIN_TOKEN,
  };
}
