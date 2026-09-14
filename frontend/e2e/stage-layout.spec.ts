import { expect, test } from "@playwright/test";
import { dialogue, start } from "./v3-helpers";

test("stage controls and grouped metrics fit narrow and wide screens", async ({
  page,
}, info) => {
  await start(page);
  for (const width of info.project.name === "mobile" ? [390] : [900, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(dialogue(page)).toBeVisible();
    await expect(page.getByRole("meter")).toHaveCount(4);
    const next = page.getByRole("button", { name: "带着当前进度进入下一幕 →" });
    await expect(next).toBeVisible();
    const inputBox = await dialogue(page).boundingBox();
    const nextBox = await next.boundingBox();
    expect(nextBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const metric = page.getByRole("meter").first();
    expect(
      await metric.evaluate(
        (el) =>
          getComputedStyle(el.parentElement!.parentElement!).backgroundColor,
      ),
    ).toBe("rgba(16, 32, 51, 0.95)");
    await page.screenshot({
      path: `../artifacts/stage-layout/${width}.jpg`,
      fullPage: true,
      quality: 75,
    });
  }
});
