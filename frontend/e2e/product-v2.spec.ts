import { test, expect } from "@playwright/test";

for (const partner of ["明确边界，暂时保持距离", "结束与谢川的关系"]) {
  test(`v2 complete branch: ${partner}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByRole("button", { name: "开发环境试玩" }).click();
    await page.getByRole("button", { name: "开始新的故事" }).click();
    await page.getByRole("button", { name: "进入故事", exact: true }).click();
    const input = page.getByRole("textbox", { name: "对角色说的话" });
    await expect(input).toBeEnabled();
    await input.fill("请不要替我定义情绪，我们只讨论事情。");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /明确表达我的边界/ }),
    ).toBeDisabled();
    await expect(input).toHaveValue("");
    await input.fill("这是尚未发送的草稿");
    await page
      .getByRole("button", { name: "私信祝福王会计", exact: true })
      .click();
    await expect(input).toHaveValue("这是尚未发送的草稿");
    await page.reload();
    await expect(input).toHaveValue("这是尚未发送的草稿");
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
    await page.getByRole("button", { name: "进入下一幕" }).click();
    await expect(page.getByRole("heading", { name: "财务窗口" })).toBeVisible();
    await page
      .getByRole("button", { name: "询问材料要求", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "补齐采购材料", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "补齐采购材料", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "请求李姐审核", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "请求李姐审核", exact: true })
      .click();
    await expect(input).toBeEnabled();
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
    await page.getByRole("button", { name: partner, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "确认这个选择", exact: true }),
    ).toBeEnabled();
    await page.reload();
    await page
      .getByRole("button", { name: "确认这个选择", exact: true })
      .click();
    await expect(input).toBeEnabled();
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
    await page.getByRole("button", { name: "进入下一幕" }).click();
    await expect(
      page.getByRole("heading", { name: "项目会议室" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "在例会上澄清传言", exact: true })
      .click();
    await expect(input).toBeEnabled();
    await page
      .getByRole("button", { name: "提交实验结果", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "暂不切割，保持距离继续观察",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "暂不切割，保持距离继续观察", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认这个选择", exact: true })
      .click();
    await expect(input).toBeEnabled();
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "保持距离 · 继续观察", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "复盘、观点卡与重玩", exact: true })
      .click();
    await page
      .getByRole("button", { name: "生成个人化复盘", exact: true })
      .click();
    await expect(
      page.getByText("实际发生与另一种可能", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../artifacts/${info.project.name}-product-v2-${partner.includes("结束") ? "breakup" : "distance"}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.getByRole("button", { name: "第一幕开始", exact: true }).click();
    await expect(page.getByRole("heading", { name: "公司食堂" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "明确表达我的边界", exact: true }),
    ).toBeEnabled();
  });
}

test("guest completion keeps progress and requires login before act two", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "立即试玩 · 第一幕", exact: true })
    .click();
  await page.getByRole("button", { name: "进入故事", exact: true }).click();
  await page
    .getByRole("button", { name: "明确表达我的边界", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "继续故事", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "继续故事", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "第一幕已完成" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "公司食堂" })).toBeVisible();
});
