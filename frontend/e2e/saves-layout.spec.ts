import { expect, test } from "@playwright/test";
import { start, state } from "./v3-helpers";

test("save cards balance counts and keep long metadata within the viewport", async ({
  page,
}, info) => {
  await start(page);
  const sample = (await state(page)).save;
  let count = 1;
  await page.route("**/api/saves", (route) =>
    route.fulfill({
      json: Array.from({ length: count }, (_, i) => ({
        ...sample,
        id: `sample-${i}`,
        parent_save_id: "long-parent-".repeat(20),
        state: {
          ...sample.state,
          ending: "一段很长但需要完整阅读的结局说明".repeat(5),
        },
      })),
    }),
  );
  for (count = 1; count <= 6; count++) {
    await page.goto("/saves");
    await expect(page.getByRole("link", { name: "打开故事" })).toHaveCount(
      count,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const link of await page.getByRole("link", { name: "打开故事" }).all())
      await expect(link).toBeVisible();
  }
  await page.screenshot({
    path: `../artifacts/saves-layout/${info.project.name}.jpg`,
    fullPage: true,
    quality: 75,
  });
  await page.getByRole("button", { name: "归档", exact: true }).first().click();
  await expect(page.getByText("这个分类还没有存档。")).toBeVisible();
});
