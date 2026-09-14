import { restoreHistoryPanel } from "./v3-helpers";
import { test, expect } from "@playwright/test";
import { start, perform, state, supplement } from "./v3-helpers";

test("new saves reward correcting a qualified return instead of copying its attachments", async ({
  page,
}, info) => {
  await start(page);
  await perform(page, "next");
  const before = (await state(page)).save.state.credit;
  await supplement(page);
  expect((await state(page)).save.state.credit).toBe(before);
  await perform(page, "dispute_return");
  expect((await state(page)).save.state.credit).toBe(before + 10);
  await restoreHistoryPanel(page);
  await expect(
    page.getByRole("region", { name: "最近一轮记录" }),
  ).toContainText("专业信用 +10");
  await page.screenshot({
    path: `../artifacts/issue-30-${info.project.name}.png`,
    fullPage: true,
  });
});
