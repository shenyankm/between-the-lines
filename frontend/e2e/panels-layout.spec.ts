import { expect, test } from "@playwright/test";
import { start } from "./v3-helpers";

test("four panels retain keyboard focus and readable content", async ({
  page,
}, info) => {
  await start(page);
  await expect(page.getByLabel("减少动态")).toHaveCount(0);
  for (const name of ["我的手机", "工作系统", "关系图", "知乎众议"]) {
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "关闭面板" })).toBeVisible();
    await expect
      .poll(() => panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
      .toBe(true);
    const rect = await panel.boundingBox();
    if (name === "知乎众议") {
      expect(await panel.evaluate((el) => el.matches(":modal"))).toBe(false);
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
    } else {
      expect(
        Math.abs(rect!.x + rect!.width / 2 - page.viewportSize()!.width / 2),
      ).toBeLessThan(2);
    }
    if (name === "工作系统" || name === "关系图") {
      await page.screenshot({
        path: `../artifacts/panels-layout/${info.project.name}-${name === "工作系统" ? "work" : "relations"}.jpg`,
        quality: 75,
      });
    }
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});
