import { expect, test } from "@playwright/test";
import { start, state } from "./v3-helpers";

test("save cards balance counts and keep long metadata within the viewport", async ({
  page,
}, info) => {
  await start(page);
  const sample = (await state(page)).save;
  let count = 1;
  const deleted = new Set<string>();
  const listed = () =>
    Array.from({ length: count }, (_, i) => ({
      ...sample,
      id: `sample-${i}`,
      parent_save_id: "long-parent-".repeat(20),
      state: {
        ...sample.state,
        ending: "一段很长但需要完整阅读的结局说明".repeat(5),
      },
    })).filter((row) => !deleted.has(row.id));
  await page.route("**/api/saves", (route) =>
    route.fulfill({ json: listed() }),
  );
  await page.route("**/api/saves/*/manage", (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3]!;
    deleted.add(id);
    return route.fulfill({
      json: { ...sample, id, deleted_at: new Date().toISOString() },
    });
  });
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
  // The loop leaves count at 7; pin the final state to the six listed cards.
  count = 6;
  await page.goto("/saves");
  await expect(page.getByRole("link", { name: "打开故事" })).toHaveCount(6);
  await page.getByRole("button", { name: "删除", exact: true }).first().click();
  const dialog = page.getByRole("alertdialog", { name: "删除存档" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("存档 sample-0 已删除")).toBeVisible();
  await expect(page.getByRole("link", { name: "打开故事" })).toHaveCount(5);
});
