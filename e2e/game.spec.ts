import { expect, test, type Page } from "@playwright/test";

async function clickVisibleBuildCell(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    if (!demo?.scene) {
      throw new Error("Missing game scene");
    }
    const canvas = document.querySelector("canvas");
    const dock = document.querySelector("#action-dock");
    if (!canvas || !dock) {
      throw new Error("Missing canvas or action dock");
    }
    const canvasRect = canvas.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const dockTop = ((dockRect.top - canvasRect.top) / canvasRect.height) * 844;
    const candidates = demo.simulation
      .getValidBuildCells("blue")
      .map((coord: { col: number; row: number }) => ({
        coord,
        point: demo.scene.coordToScreen(coord),
      }))
      .filter(
        ({ point }: { point: { x: number; y: number } }) =>
          point.x >= 28 && point.x <= 362 && point.y >= 124 && point.y <= dockTop - 10,
      )
      .sort(
        (
          a: { point: { x: number; y: number } },
          b: { point: { x: number; y: number } },
        ) => a.point.y - b.point.y || Math.abs(a.point.x - 195) - Math.abs(b.point.x - 195),
      );
    if (candidates.length === 0) {
      throw new Error("No visible build cell");
    }
    const scaleX = canvasRect.width / 390;
    const scaleY = canvasRect.height / 844;
    return {
      x: candidates[0].point.x * scaleX,
      y: candidates[0].point.y * scaleY,
    };
  });
  await page.locator("canvas").click({ position: point });
}

async function baseCitySpan(page: Page): Promise<number> {
  return page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    const red = demo.scene.coordToScreen(demo.simulation.getCity("red"));
    const blue = demo.scene.coordToScreen(demo.simulation.getCity("blue"));
    return Math.abs(blue.y - red.y);
  });
}

async function visibleGold(page: Page): Promise<number> {
  await expect(page.locator("#gold-value")).toBeVisible();
  return Number(await page.locator("#gold-value").textContent());
}

async function redCityX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    return demo.scene.coordToScreen(demo.simulation.getCity("red")).x;
  });
}

async function playfieldMetrics(page: Page): Promise<{
  blueCityBottom: number;
  dockHeight: number;
  dockTop: number;
  visibleBuildCells: number;
}> {
  return page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    const canvas = document.querySelector("canvas");
    const dock = document.querySelector("#action-dock");
    if (!canvas || !dock) {
      throw new Error("Missing canvas or action dock");
    }
    const canvasRect = canvas.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const scaleX = canvasRect.width / 390;
    const scaleY = canvasRect.height / 844;
    const toPage = (point: { x: number; y: number }) => ({
      x: canvasRect.left + point.x * scaleX,
      y: canvasRect.top + point.y * scaleY,
    });
    const blue = toPage(demo.scene.coordToScreen(demo.simulation.getCity("blue")));
    const visibleBuildCells = demo.simulation
      .getValidBuildCells("blue")
      .map((coord: { col: number; row: number }) => toPage(demo.scene.coordToScreen(coord)))
      .filter(
        (point: { x: number; y: number }) =>
          point.x >= canvasRect.left + 24 &&
          point.x <= canvasRect.right - 24 &&
          point.y >= canvasRect.top + 104 &&
          point.y <= dockRect.top - 10,
      ).length;
    return {
      blueCityBottom: blue.y + 24 * scaleY,
      dockHeight: dockRect.height,
      dockTop: dockRect.top,
      visibleBuildCells,
    };
  });
}

test("completes the core build, pause, and restart flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "疆域铸造" })).toBeVisible();
  await expect(page.locator(".race-picker, .race-card, [data-action='set-race']")).toHaveCount(0);
  await expect(page.locator(".unit-role-card")).toHaveCount(3);
  await expect(page.locator(".unit-role-card").getByText("战士", { exact: true })).toBeVisible();
  await expect(page.locator(".unit-role-card").getByText("射手", { exact: true })).toBeVisible();
  await expect(page.locator(".unit-role-card").getByText("攻城兵", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始征战" }).click();
  expect(await visibleGold(page)).toBeGreaterThanOrEqual(120);
  await expect(page.locator(".battle-header").getByText("蔚蓝领主", { exact: true })).toBeVisible();
  await expect(page.locator(".battle-header").getByText("赤焰军团", { exact: true })).toBeVisible();
  await expect(page.locator("#tutorial-bubble")).toHaveCount(0);
  await expect(page.locator(".zoom-controls")).toHaveCount(0);
  await expect(page.getByText("点高亮空地建造，点建筑管理")).toBeVisible();

  await clickVisibleBuildCell(page);
  await expect(page.getByText("选择建筑")).toBeVisible();
  const buildLayout = await page.locator("#action-dock").evaluate((dock) => {
    const structures = Array.from(dock.querySelectorAll<HTMLElement>(".structure-row .build-chip"));
    const barracks = Array.from(dock.querySelectorAll<HTMLElement>(".barracks-row .build-chip"));
    const structureRects = structures.map((card) => card.getBoundingClientRect());
    const barracksRects = barracks.map((card) => card.getBoundingClientRect());
    const mineImage = dock.querySelector<HTMLImageElement>('[data-kind="mine"] img');
    return {
      structureCount: structures.length,
      barracksCount: barracks.length,
      firstRowBottom: Math.max(...structureRects.map((rect) => rect.bottom)),
      secondRowTop: Math.min(...barracksRects.map((rect) => rect.top)),
      mineImageLoaded: Boolean(mineImage?.complete && mineImage.naturalWidth > 0),
      mineCopy: dock.querySelector('[data-kind="mine"]')?.textContent?.replace(/\s+/g, " ").trim(),
      barracksCopy: barracks[0]?.textContent?.replace(/\s+/g, " ").trim(),
    };
  });
  expect(buildLayout.structureCount).toBe(2);
  expect(buildLayout.barracksCount).toBe(3);
  expect(buildLayout.firstRowBottom).toBeLessThan(buildLayout.secondRowTop);
  expect(buildLayout.mineImageLoaded).toBe(true);
  expect(buildLayout.mineCopy).toContain("建造");
  expect(buildLayout.barracksCopy).toContain("生产/轮");
  await page.locator('[data-action="build"][data-kind="mine"]').click();
  await expect(page.getByText("金矿")).toBeVisible();

  await page.waitForTimeout(5400);
  await clickVisibleBuildCell(page);
  await expect(page.locator('[data-action="build-barracks"]')).toHaveCount(3);
  await expect(page.locator('[data-action="build-barracks"][data-unit-type="warrior"]')).toBeVisible();
  await expect(page.locator('[data-action="build-barracks"][data-unit-type="archer"]')).toBeVisible();
  await expect(page.locator('[data-action="build-barracks"][data-unit-type="siege"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /战士营/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /射手营/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /攻城兵营/ })).toBeVisible();
  await page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    demo.simulation.state.players.blue.gold = 1000;
  });
  await page.locator('[data-action="build-barracks"][data-unit-type="archer"]').click();
  await expect(page.locator("#action-dock").getByText("射手营 Lv.1")).toBeVisible();
  await expect(page.locator("#action-dock").getByText(/自动生产 射手 · 远程高攻/)).toBeVisible();
  await expect(page.locator("#action-dock").getByText(/准备自动生产|金币不足，自动等待|正在生产/)).toBeVisible();
  await expect(page.locator('[data-action="train"]')).toHaveCount(0);
  await expect(page.locator(".queue-box")).toHaveCount(0);
  await expect(page.locator(".unit-chip")).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    const barracks = Object.values(demo.simulation.state.buildings).find(
      (building: any) => building.owner === "blue" && building.kind === "barracks",
    ) as any;
    return Boolean(barracks?.production?.paid);
  })).toBe(true);
  await page.getByRole("button", { name: "暂停生产" }).click();
  await expect(page.getByText("本轮结束后暂停")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    const barracks = Object.values(demo.simulation.state.buildings).find(
      (building: any) => building.owner === "blue" && building.kind === "barracks",
    ) as any;
    return barracks?.productionMode;
  }), { timeout: 8000 }).toBe("paused");
  await expect(page.getByRole("button", { name: "继续生产" })).toBeVisible();
  await page.getByRole("button", { name: "继续生产" }).click();
  await expect.poll(() => page.evaluate(() => {
    const demo = (window as any).__territoryDemo;
    const barracks = Object.values(demo.simulation.state.buildings).find(
      (building: any) => building.owner === "blue" && building.kind === "barracks",
    ) as any;
    return barracks?.productionMode === "running" && barracks?.production?.paid;
  })).toBe(true);

  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByText("运筹一下")).toBeVisible();
  await page.getByRole("button", { name: "继续战斗" }).click();
  await expect(page.getByText("运筹一下")).toBeHidden();

  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "重新开始" }).click();
  expect(await visibleGold(page)).toBeGreaterThanOrEqual(120);
  await expect(page.locator("#tutorial-bubble")).toHaveCount(0);
  await expect(page.getByText("点高亮空地建造，点建筑管理")).toBeVisible();
});

test("keeps the vertical HUD readable at 360 by 800", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "开始征战" }).click();
  await expect(page.locator("#action-dock")).toBeInViewport();
  await expect(page.locator(".battle-header")).toBeInViewport();
  await expect(page.locator("#gold-value")).toBeVisible();
  await expect(page.locator("#tutorial-bubble")).toHaveCount(0);
  await expect(page.locator(".zoom-controls")).toHaveCount(0);
  const metrics = await playfieldMetrics(page);
  expect(metrics.dockHeight).toBeLessThanOrEqual(54);
  expect(metrics.blueCityBottom).toBeLessThan(metrics.dockTop - 8);
  expect(metrics.visibleBuildCells).toBeGreaterThan(0);

  await clickVisibleBuildCell(page);
  await expect(page.locator('[data-action="build-barracks"]')).toHaveCount(3);
  const buildPanelMetrics = await page.locator("#action-dock").evaluate((dock) => {
    const rect = dock.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      viewportHeight: window.innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(buildPanelMetrics.height).toBeLessThanOrEqual(160);
  expect(buildPanelMetrics.bottom).toBeLessThanOrEqual(buildPanelMetrics.viewportHeight);
  expect(buildPanelMetrics.pageWidth).toBeLessThanOrEqual(buildPanelMetrics.viewportWidth);

  await page.locator('[data-action="build-barracks"][data-unit-type="warrior"]').click();
  await expect(page.locator('[data-action="set-production-pause"]')).toBeVisible();
  const barracksPanelMetrics = await page.locator("#action-dock").evaluate((dock) => {
    const rect = dock.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      viewportHeight: window.innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(barracksPanelMetrics.height).toBeLessThanOrEqual(116);
  expect(barracksPanelMetrics.bottom).toBeLessThanOrEqual(barracksPanelMetrics.viewportHeight);
  expect(barracksPanelMetrics.pageWidth).toBeLessThanOrEqual(barracksPanelMetrics.viewportWidth);
});

test("supports wheel zoom and drag without visible zoom controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开始征战" }).click();
  await expect(page.locator(".zoom-controls")).toHaveCount(0);
  const initialSpan = await baseCitySpan(page);

  await page.locator("canvas").hover({ position: { x: 195, y: 420 } });
  await page.mouse.wheel(0, -700);
  await expect.poll(() => baseCitySpan(page)).toBeGreaterThan(initialSpan + 20);

  const beforeDrag = await redCityX(page);
  await page.evaluate(() => {
    const input = (window as any).__territoryDemo.scene.input;
    const pointer = { id: 7, x: 195, y: 420 };
    input.emit("pointerdown", pointer);
    for (const x of [180, 165, 150, 135, 120, 110]) {
      pointer.x = x;
      input.emit("pointermove", pointer);
    }
    input.emit("pointerup", pointer);
  });
  await expect.poll(() => redCityX(page)).toBeLessThan(beforeDrag - 12);

  await page.evaluate(() => (window as any).__territoryDemo.scene.resetView());
  await expect.poll(() => baseCitySpan(page)).toBeLessThan(initialSpan + 5);
  await expect(page.locator(".battle-header").getByText("赤焰军团", { exact: true })).toBeVisible();
  await expect(page.locator(".battle-header").getByText("蔚蓝领主", { exact: true })).toBeVisible();
});
