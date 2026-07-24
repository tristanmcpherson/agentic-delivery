#!/usr/bin/env node

import { selectNextAction } from "../src/next-action.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  console.log(JSON.stringify(selectNextAction(JSON.parse(input))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
