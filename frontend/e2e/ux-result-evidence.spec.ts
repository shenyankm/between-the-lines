import { test, expect } from "@playwright/test";
import { start, perform } from "./v3-helpers";

test("results explain deltas, read back their source and offer the next actual action", async ({
  page,
}, info) => {
  await start(page);
  await perform(page, "next");
  await perform(page, "dispute_return");
  const receipt = page.getByRole("region", { name: "最近一轮记录" });
  await expect(receipt).toContainText("本次没有指标增减");
  await receipt.getByRole("button", { name: "查看原始事件" }).click();
  await expect(receipt.locator("blockquote")).toContainText(
    "李姐核对普通采购模板",
  );
  await receipt.getByText("事项记录的变化", { exact: true }).click();
  await expect(receipt).toContainText("原始材料有效");
  await expect(
    receipt.getByRole("button", { name: "下一步：提交李姐审核" }),
  ).toBeEnabled();
  await page.screenshot({
    path: `../artifacts/issue-28-${info.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(receipt).toContainText("最近一轮 · 已保存记录");
});
