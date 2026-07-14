import fs from "node:fs/promises";
import process from "node:process";

const [inputFile, outputFile, mode = "healthy"] = process.argv.slice(2);
if (!inputFile || !outputFile) throw new Error("Pass input and output queue paths.");
await new Promise((resolve) => setTimeout(resolve, 75));
const event = JSON.parse(await fs.readFile(inputFile, "utf8"));
const result = mode === "broken"
  ? { message_id: event.message_id, correlation_id: "wrong-correlation", status: "acknowledged", projection: null }
  : { message_id: event.message_id, correlation_id: event.correlation_id, status: "processed", projection: { profile_id: event.payload.profile_id, indexed: true } };
await fs.writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
