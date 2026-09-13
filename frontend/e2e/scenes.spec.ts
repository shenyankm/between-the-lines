import { test, expect } from "@playwright/test";
import { start, state, perform, readScene } from "./v3-helpers";
test("v3 locations, portraits and reading positions survive reload without layout overflow", async ({
  page,
}, info) => {
  await start(page);
  for (let act = 1; act <= 3; act++) {
    const p = await state(page);
    expect(p.save.state.act).toBe(act);
    const bg = await page
      .locator("main")
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain(".webp");
    expect(
      await page.locator("main img").evaluateAll(async (images) => {
        await Promise.all(images.map((i) => (i as HTMLImageElement).decode()));
        return images.every((i) => (i as HTMLImageElement).naturalWidth > 0);
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../artifacts/${info.project.name}-v3-act-${act}.png`,
      fullPage: true,
    });
    await page.reload();
    await readScene(page);
    expect((await state(page)).reading).toEqual(p.reading);
    if (act < 3) await perform(page, "next");
  }
});
