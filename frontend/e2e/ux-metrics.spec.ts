import { test, expect } from "@playwright/test";
import { start } from "./v3-helpers";

test("metric descriptions state current limitations next to the values", async ({
  page,
}, info) => {
  await start(page);
  await page.getByText("指标如何影响本局", { exact: true }).click();
  await expect(page.getByText(/目前没有按数值高低自动改变 NPC/)).toBeVisible();
  await expect(page.getByText(/高信用不能绕过材料/)).toBeVisible();
  await page.screenshot({
    path: `../artifacts/issue-29-${info.project.name}.png`,
    fullPage: true,
  });
});
