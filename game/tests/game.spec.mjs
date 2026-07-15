import { test, expect } from "../../plugins/vision/assets/playwright/agentic-evidence.mjs";
import path from "node:path";

const artifacts = path.resolve("test-results", "pulse-runner");

test("desktop gameplay journey", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Stay in the signal/ })).toBeVisible();
  await page.getByRole("button", { name: /start run/i }).click();
  await expect(page.locator("#game")).toHaveAttribute("data-mode", "running");

  const startX = Number(await page.locator("#game").getAttribute("data-player-x"));
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowRight");
  const movedX = Number(await page.locator("#game").getAttribute("data-player-x"));
  expect(movedX).toBeGreaterThan(startX + 30);
  await expect.poll(async () => Number(await page.locator("#game").getAttribute("data-score"))).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(page.getByRole("heading", { name: "Hold the line." })).toBeVisible();
  await page.getByRole("button", { name: /resume/i }).click();
  await expect(page.locator("#game")).toHaveAttribute("data-mode", "running");
  await page.screenshot({ path: path.join(artifacts, "desktop-gameplay.png"), fullPage: true });
});

test("mobile controls and layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Steer left" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Steer right" })).toBeVisible();
  await page.getByRole("button", { name: /start run/i }).click();
  const startX = Number(await page.locator("#game").getAttribute("data-player-x"));
  await page.getByRole("button", { name: "Steer left" }).dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch" });
  await page.waitForTimeout(380);
  await page.getByRole("button", { name: "Steer left" }).dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch" });
  const movedX = Number(await page.locator("#game").getAttribute("data-player-x"));
  expect(movedX).toBeLessThan(startX - 20);
  await page.screenshot({ path: path.join(artifacts, "mobile-gameplay.png"), fullPage: true });
});
