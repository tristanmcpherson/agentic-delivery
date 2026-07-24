import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = path.resolve(process.argv[2]);
const moduleUrl = `${pathToFileURL(path.join(workspace, "src", "next-action.mjs")).href}?grader=${Date.now()}`;
const { selectNextAction } = await import(moduleUrl);

assert.deepEqual(selectNextAction({
  current_status: "locally-verified",
  completion_target: "closure-verified",
  checks: [{ id: "unit", status: "pass", required: true }],
}), { kind: "request-protected-verification" });

assert.deepEqual(selectNextAction({
  current_status: "closure-verified",
  completion_target: "delivered-and-verified",
  checks: [{ id: "closure", status: "pass", required: true }],
}), { kind: "request-delivery-verification" });

assert.deepEqual(selectNextAction({
  current_status: "implemented-not-verified",
  completion_target: "locally-verified",
  checks: [{ id: "unit", status: "pass", required: true }],
}), { kind: "promote-local-verification" });

console.log("logic-cli hidden target passed");
