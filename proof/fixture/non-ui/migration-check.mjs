import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const mode = process.argv.includes("--broken") ? "broken" : "healthy";
const artifactDir = process.env.AGENTIC_ARTIFACT_DIR;
const attestationFile = process.env.AGENTIC_SYSTEM_ATTESTATION;
const nonce = process.env.AGENTIC_RUN_NONCE;
if (!artifactDir || !attestationFile || !nonce) throw new Error("Agentic evidence environment is incomplete.");

function hash(value) {
  const input = Buffer.isBuffer(value) ? value : typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(input).digest("hex");
}

function seed(database) {
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    INSERT INTO schema_migrations(version) VALUES (1);
    CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO profiles(id, name) VALUES (1, 'Avery Stone');
  `);
}

function applyMigration(database, broken = false) {
  database.exec("BEGIN");
  database.exec("ALTER TABLE profiles ADD COLUMN display_name TEXT");
  database.exec(broken ? "UPDATE profiles SET display_name = NULL" : "UPDATE profiles SET display_name = name");
  database.exec("INSERT INTO schema_migrations(version) VALUES (2)");
  database.exec("COMMIT");
}

function schema(database) {
  return database.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
}

function testRollback() {
  const database = new DatabaseSync(":memory:");
  seed(database);
  applyMigration(database);
  database.exec(`
    BEGIN;
    CREATE TABLE profiles_v1 (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO profiles_v1(id, name) SELECT id, display_name FROM profiles;
    DROP TABLE profiles;
    ALTER TABLE profiles_v1 RENAME TO profiles;
    DELETE FROM schema_migrations WHERE version = 2;
    COMMIT;
  `);
  const columns = database.prepare("PRAGMA table_info(profiles)").all().map((row) => row.name);
  const row = database.prepare("SELECT id, name FROM profiles WHERE id = 1").get();
  const version = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
  database.close();
  return { pass: JSON.stringify(columns) === JSON.stringify(["id", "name"]) && row?.name === "Avery Stone" && version === 1, columns, row, version };
}

await fs.mkdir(artifactDir, { recursive: true });
const databasePath = path.join(artifactDir, "migration-proof.sqlite");
const database = new DatabaseSync(databasePath);
seed(database);
const before = schema(database);
applyMigration(database, mode === "broken");
const after = schema(database);
const columns = database.prepare("PRAGMA table_info(profiles)").all().map((row) => row.name);
const row = database.prepare("SELECT id, name, display_name FROM profiles WHERE id = 1").get();
const version = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
database.close();
const rollback = testRollback();
const fileHash = hash(await fs.readFile(databasePath));

const details = {
  migration: { id: "002-add-display-name", version },
  schema: { before, after, columns },
  row,
  rollback,
};
const assertions = [
  { id: "migration-applied", status: version === 2 ? "pass" : "fail", evidence_sha256: hash({ version }) },
  { id: "schema-current", status: columns.includes("display_name") ? "pass" : "fail", evidence_sha256: hash({ columns }) },
  { id: "data-preserved", status: row?.display_name === row?.name && row?.name === "Avery Stone" ? "pass" : "fail", evidence_sha256: hash({ row }) },
  { id: "rollback-compatible", status: rollback.pass ? "pass" : "fail", evidence_sha256: hash(rollback) },
];
const nonceHash = hash(nonce);
const attestation = {
  schema_version: 1,
  kind: "migration",
  task_id: process.env.AGENTIC_TASK_ID,
  check_id: process.env.AGENTIC_CHECK_ID,
  run_nonce_sha256: nonceHash,
  correlation_id_sha256: nonceHash,
  subject: { type: "sqlite", identity: `sha256:${fileHash}` },
  operation: { id: "002-add-display-name", input_sha256: hash(before), output_sha256: hash(after) },
  assertions,
  details,
};
await fs.writeFile(attestationFile, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
console.log(`migration fixture ${mode}: ${assertions.map((item) => `${item.id}=${item.status}`).join(", ")}`);
