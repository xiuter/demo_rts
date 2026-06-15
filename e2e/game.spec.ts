import { expect, test } from "@playwright/test";

test("completes the core build, pause, and restart flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "疆域铸造" })).toBeVisible();
  await page.getByRole("button", { name: "开始征战" }).click();
  await expect(page.locator("#gold-value")).toHaveText("120");

  const canvas = page.locator("canvas");
  await canvas.click({ position: { x: 195, y: 533 } });
  await expect(page.getByText("选择建筑")).toBeVisible();
  await page.locator('[data-action="build"][data-kind="mine"]').click();
  await expect(page.getByText("第二步：准备军队")).toBeVisible();

  await page.waitForTimeout(3600);
  await canvas.click({ position: { x: 179, y: 506 } });
  await page.locator('[data-action="build"][data-kind="barracks"]').click();
  await expect(page.getByText("第三步：训练步兵")).toBeVisible();

  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByText("运筹一下")).toBeVisible();
  await page.getByRole("button", { name: "继续战斗" }).click();
  await expect(page.getByText("运筹一下")).toBeHidden();

  await page.getByRole("button", { name: "暂停" }).click();
  await page.getByRole("button", { name: "重新开始" }).click();
  await expect(page.locator("#gold-value")).toHaveText("120");
  await expect(page.getByText("第一步：建立经济")).toBeVisible();
});

test("keeps the vertical HUD readable at 360 by 800", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "开始征战" }).click();
  await expect(page.locator("#action-dock")).toBeInViewport();
  await expect(page.locator(".battle-header")).toBeInViewport();
  await expect(page.locator("#gold-value")).toBeVisible();
});

