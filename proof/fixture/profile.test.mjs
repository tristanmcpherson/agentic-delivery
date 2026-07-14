import assert from "node:assert/strict";
import test from "node:test";
import { parseProfile } from "./profile.mjs";

test("parseProfile accepts the UI contract", () => {
  assert.deepEqual(parseProfile({ displayName: " Avery Stone ", role: "Engineer" }), {
    displayName: "Avery Stone",
    role: "Engineer"
  });
});

test("parseProfile rejects the legacy API shape", () => {
  assert.throws(() => parseProfile({ name: "Avery Stone" }), /incompatible response/);
});
