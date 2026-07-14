import { test, expect } from "../../../plugins/agentic-delivery/assets/playwright/agentic-evidence.mjs";

test("real service profile journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("api-origin")).toHaveText(process.env.AGENTIC_API_ORIGIN);
  await page.getByRole("button", { name: "Load verified profile" }).click();
  await expect(page.getByTestId("display-name")).toHaveText(`Avery ${process.env.AGENTIC_RUN_NONCE.slice(0, 8)}`);
  await expect(page.getByTestId("role")).toHaveText("Engineer");
  await expect(page.getByTestId("status")).toContainText("Ready");
});
