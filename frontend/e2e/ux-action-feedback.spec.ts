import { restoreHistoryPanel } from "./v3-helpers";
import { test, expect } from "@playwright/test";
import { start, dialogue, state } from "./v3-helpers";

test("a polite boundary expression has a visible recipient and persisted action receipt", async ({
  page,
}, info) => {
  await start(page);
  await expect(page.getByText("现场 · 对孙淼说")).toBeVisible();
  await dialogue(page).fill("我不接受你替我决定，但是我愿意听你解释");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect
    .poll(async () => {
      const p = await state(page);
      return (
        "relationship" in p.save.state &&
        !!p.save.state.relationship?.facts?.boundary
      );
    })
    .toBe(true);
  await restoreHistoryPanel(page);
  await expect(
    page.getByRole("region", { name: "最近一轮记录" }),
  ).toContainText("不接受别人代替决定");
  await page.screenshot({
    path: `../artifacts/issue-26-${info.project.name}.png`,
    fullPage: true,
  });
});
