import { test, expect } from "../../../plugins/agentic-delivery/assets/playwright/agentic-evidence.mjs";

test("mocked profile journey", async ({ page, agenticEvidence }) => {
  const apiOrigin = process.env.AGENTIC_API_ORIGIN;
  agenticEvidence.markFirstPartyMocked();
  await page.route(`${apiOrigin}/api/profile`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-agentic-environment": "mocked" },
      body: JSON.stringify({ displayName: "Avery Stone", role: "Engineer" })
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Load verified profile" }).click();
  await expect(page.getByTestId("display-name")).toHaveText("Avery Stone");
  await expect(page.getByTestId("status")).toContainText("Ready");
});
