import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/saves", async (route) => {
    if (route.request().method() === "POST")
      await route.continue({
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          story_version: 1,
        }),
      });
    else await route.continue();
  });
});

for (const branch of [
  {
    action: "cut_ties",
    label: "结束与孙淼的私人来往，仅保留工作沟通",
    ending: "找回自我 · 只留工作往来",
    relationship: "已结束私人来往，仅保留必要的工作沟通。",
  },
  {
    action: "keep_distance",
    label: "暂不切割，保持距离继续观察",
    ending: "保持距离 · 继续观察",
    relationship: "保持距离继续观察，暂不恢复亲密，也未彻底切割。",
  },
]) {
  test(`complete ${branch.action} story, work tools, persistence and responsive layout`, async ({
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
    await page.getByRole("button", { name: "当众质问孙淼" }).click();
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
    await input.fill("请支持项目跟进。");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(input).toBeEnabled();
    await page.getByRole("button", { name: "手机", exact: true }).click();
    await page.getByRole("button", { name: "李姐 财务会计" }).click();
    await input.fill("材料已经提交，请审核采购。");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(input).toBeEnabled();
    await page.getByRole("button", { name: "工作系统", exact: true }).click();
    await expect(
      page.getByText("审核已通过，材料可以进入采购。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "财务窗口" })).toBeVisible();
    await page.getByRole("button", { name: "继续故事" }).click();
    await page.getByRole("button", { name: "进入下一幕" }).click();
    await expect(
      page.getByRole("heading", { name: "项目会议室" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "在例会上澄清传言" }).click();
    await expect(input).toBeEnabled();
    await expect(page.getByRole("button", { name: branch.label })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "提交实验结果" }).click();
    await expect(input).toBeEnabled();
    await expect(page.getByRole("button", { name: "继续故事" })).toBeDisabled();
    await page.getByRole("button", { name: branch.label }).click();
    await expect(input).toBeEnabled();
    await page.reload();
    await page.getByRole("button", { name: "手机", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "人物关系 · 当前进展" }),
    ).toBeVisible();
    await expect(page.getByText(/前男友。你已提出分手/)).toBeVisible();
    await expect(
      page.getByText(branch.relationship, { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `../artifacts/${testInfo.project.name}-relationships-${branch.action}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page.getByRole("button", { name: "继续故事" }).click();
    await expect(
      page.getByRole("heading", { name: branch.ending }),
    ).toBeVisible();
    await page.getByRole("button", { name: "生成故事回顾" }).click();
    await expect(page.getByText(/你为这段经历选择了/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("refresh recovers an accepted reply without repeating the request", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.getByRole("button", { name: "进入故事" }).click();
  await expect(
    page.getByRole("button", { name: "明确表达我的边界" }),
  ).toBeEnabled();
  let submissions = 0;
  let accepted!: () => void;
  const committed = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route("**/api/saves/*/turns", async (route) => {
    submissions += 1;
    await route.fetch();
    accepted();
    await route.abort();
  });
  await page
    .getByRole("textbox", { name: "对角色说的话" })
    .fill("刷新恢复验证");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await committed;
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "对角色说的话" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "回顾", exact: true }).click();
  await expect(page.getByText("刷新恢复验证", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith("pending:"),
          ).length,
      ),
    )
    .toBe(0);
  expect(submissions).toBe(1);
});
