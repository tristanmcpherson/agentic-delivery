import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationServer } from "../server.mjs";

test("real orders endpoint returns the documented correlated contract", async () => {
  const server = createApplicationServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/orders?nonce=visible-nonce`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      request_nonce: "visible-nonce",
      orders: [
        { order_id: "A-100", total_cents: 1234 },
        { order_id: "B-200", total_cents: 5099 },
      ],
    });
    assert.equal((await fetch(base)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
