import { test, expect } from "@playwright/test";

test("natural dialogue proposes an action, survives refresh, and waits for consent", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.getByRole("button", { name: "进入故事" }).click();
  const input = page.getByRole("textbox", { name: "对角色说的话" });
  await expect(input).toBeEnabled();
  await input.fill("以后不要替我定义情绪，我要把这个边界说清楚。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认行动" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "继续故事" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "确认行动" })).toBeEnabled();
  await page.getByRole("button", { name: "确认行动" }).click();
  await expect(page.getByRole("button", { name: "继续故事" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "明确表达我的边界" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "菱菱，我不是关心你嘛。好，以后就说工作，你可别又觉得我生分。",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("conflict repair and private verification form a complete alternative story", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.getByRole("button", { name: "进入故事" }).click();
  const input = page.getByRole("textbox", { name: "对角色说的话" });
  async function choose(name: string) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(input).toBeEnabled();
  }
  async function chat(text: string) {
    await input.fill(text);
    await choose("发送");
  }
  await expect(input).toBeEnabled();
  await choose("当众质问孙淼");
  await choose("继续故事");
  await choose("进入下一幕");
  await expect(page.getByLabel("选择带来的后果")).toContainText("书面");
  await chat("请明确缺少哪些材料。");
  await choose("补齐采购材料");
  await chat("请审核采购。");
  await expect(page.getByRole("button", { name: "继续故事" })).toBeEnabled();
  await choose("私下修复沟通");
  await expect(
    page.getByRole("button", { name: "提交书面沟通记录" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "手机", exact: true }).click();
  await page.getByRole("button", { name: "李姐 财务会计" }).click();
  await chat("材料已补齐，请审核采购。");
  await choose("继续故事");
  await choose("进入下一幕");
  await expect(page.getByLabel("选择带来的后果")).toContainText("实验窗口");
  await choose("保留证据，请张工私下核实");
  await expect(
    page.getByRole("button", { name: "在例会上澄清传言" }),
  ).toBeDisabled();
  await choose("提交实验结果");
  await page.getByRole("button", { name: "继续故事" }).click();
  await expect(
    page.getByRole("heading", { name: "克制留痕，关系待定" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "克制留痕，关系待定" }),
  ).toBeVisible();
});
