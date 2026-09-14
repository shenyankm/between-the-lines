import { test, expect } from "@playwright/test";
import { start, state, perform } from "./v3-helpers";

test("a grounded reflection links its original event to a separate earlier replay", async ({
  page,
}, info) => {
  await start(page);
  for (const action of [
    "boundary",
    "next",
    "next",
    "keep_distance",
    "close_story",
  ] as const)
    await perform(page, action);
  const original = (await state(page)).save;
  await expect(
    page.getByRole("heading", { name: /本局表达倾向/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "完整记录", exact: true }).click();
  await page.getByRole("button", { name: "生成个人化复盘" }).click();
  const nodes = page.getByRole("region", { name: "关键表达与另一种可能" });
  const replay = nodes
    .filter({ has: page.getByRole("button", { name: "从这里尝试另一种回应" }) })
    .first();
  await expect(replay).toContainText("另一种可能（由我尝试，尚未发生）");
  await expect(replay).toContainText("可能代价：");
  await expect(replay).toContainText("位于这次表达之前");
  await replay.getByRole("button", { name: "查看原始事件" }).click();
  await expect(replay.locator("blockquote")).toContainText("对象：孙淼");
  await replay
    .getByRole("button", { name: "从这里尝试另一种回应" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `../artifacts/issue-36-${info.project.name}.png`,
    fullPage: false,
  });
  await replay.getByRole("button", { name: "从这里尝试另一种回应" }).click();
  await expect(page).not.toHaveURL(new RegExp(original.id));
  const branched = (await state(page)).save;
  expect(branched.id).not.toBe(original.id);
  expect(branched.parent_save_id).toBe(original.id);
  expect(branched.state.ending).toBeNull();
  const persisted = await page.request.get(`/api/saves/${original.id}`);
  expect(((await persisted.json()) as { state: unknown }).state).toEqual(
    original.state,
  );
});
