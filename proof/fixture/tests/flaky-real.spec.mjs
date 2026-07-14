import { test, expect } from "../../../plugins/agentic-delivery/assets/playwright/agentic-evidence.mjs";

test("flaky real service journey", async ({ page }, testInfo) => {
  expect(testInfo.retry, "the seeded first attempt must fail").toBeGreaterThan(0);
  await page.goto("/");
  await page.getByRole("button", { name: "Load verified profile" }).click();
  await expect(page.getByTestId("display-name")).toHaveText(`Avery ${process.env.AGENTIC_RUN_NONCE.slice(0, 8)}`);
  await expect(page.getByTestId("status")).toContainText("Ready");
});
