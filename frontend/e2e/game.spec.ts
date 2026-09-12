import { test, expect } from "@playwright/test";

test("complete story, work tools, persistence and responsive layout", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await expect(page.getByRole("button", { name: "进入故事" })).toBeVisible();
  await page.getByRole("button", { name: "进入故事" }).click();
  await expect(
    page.getByRole("button", { name: "明确表达我的边界" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "明确表达我的边界" }).click();
  await expect(page.getByRole("button", { name: "继续故事" })).toBeEnabled();
  await page.getByRole("button", { name: "继续故事" }).click();
  await page.getByRole("button", { name: "进入下一幕" }).click();
  await expect(page.getByRole("heading", { name: "财务窗口" })).toBeVisible();
  await page.screenshot({
    path: `../artifacts/${testInfo.project.name}-game.png`,
    fullPage: true,
  });
  const input = page.getByRole("textbox", { name: "对角色说的话" });
  await input.fill("请明确缺少哪些材料。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(input).toBeEnabled();
  await page.getByRole("button", { name: "补齐采购材料" }).click();
  await expect(input).toBeEnabled();
  await page.getByRole("button", { name: "向张工同步进度" }).click();
  await expect(input).toBeEnabled();
  await page.getByRole("button", { name: "手机", exact: true }).click();
  await page.getByRole("button", { name: "李姐 财务会计" }).click();
  await input.fill("材料已经提交，请审核采购。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(input).toBeEnabled();
  await page.getByRole("button", { name: "工作系统", exact: true }).click();
  await expect(page.getByText("审核已通过，材料可以进入采购。")).toBeVisible();
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "财务窗口" })).toBeVisible();
  await page.getByRole("button", { name: "继续故事" }).click();
  await page.getByRole("button", { name: "进入下一幕" }).click();
  await expect(page.getByRole("heading", { name: "项目会议室" })).toBeVisible();
  await page.getByRole("button", { name: "在例会上澄清传言" }).click();
  await expect(input).toBeEnabled();
  await page.getByRole("button", { name: "提交实验结果" }).click();
  await expect(input).toBeEnabled();
  await page.getByRole("button", { name: "继续故事" }).click();
  await expect(
    page.getByRole("heading", { name: "保持职业关系和边界" }),
  ).toBeVisible();
  await expect(page.getByText(/你为这段经历选择了/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
