import { test, expect } from "@playwright/test";

for (const publicRoute of [false, true]) {
  test(`investigated ${publicRoute ? "public" : "private"} route persists reasons and downloads result`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "开发环境试玩" }).click();
    await page.getByRole("button", { name: "开始新的故事" }).click();
    await page.getByRole("button", { name: "进入故事" }).click();
    const input = page.getByRole("textbox", { name: "对角色说的话" });
    await expect(input).toBeEnabled();
    async function choose(name: string) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      await expect(input).toBeEnabled();
    }
    async function decide(name: string, reason: string) {
      await choose(name);
      await expect(
        page.getByRole("button", { name: "确认这个选择" }),
      ).toBeDisabled();
      await page.getByRole("textbox", { name: "我为什么这样选" }).fill(reason);
      await choose("确认这个选择");
    }
    async function chat(text: string) {
      await input.fill(text);
      await choose("发送");
    }
    await choose(publicRoute ? "当众质问孙淼" : "明确表达我的边界");
    await choose("继续故事");
    await choose("进入下一幕");
    await choose("问孙淼：采购单卡在哪一步");
    await choose("问李姐：什么时候收到单据");
    await choose("调取采购流转日志");
    if (publicRoute) {
      await expect(
        page.getByRole("button", { name: "私下追问孙淼为何延迟转交" }),
      ).toBeDisabled();
      await choose("向张工同步进度");
      await decide(
        "向张工提交延误记录",
        "我希望明确延误责任，接受公开核查带来的压力。",
      );
      await choose("参加公司协调，提交事实记录");
    } else {
      await choose("私下追问孙淼为何延迟转交");
      await decide(
        "私下纠正流程，保留记录",
        "先保住项目，保留记录不等于原谅。",
      );
    }
    await page.reload();
    await expect(input).toBeEnabled();
    await expect(page.getByLabel("调查与取舍")).toContainText("采购流转日志");
    await page.getByText("换个角度想 · 知乎观点", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: /猎鹰家的小鼠/ }),
    ).toHaveAttribute("href", /zhihu.com\/question/);
    await expect(
      page.getByRole("button", { name: "补齐采购材料", exact: true }),
    ).toBeEnabled();
    await choose("补齐采购材料");
    await chat("材料齐了，请审核采购。");
    await expect(
      page.getByRole("button", { name: "继续故事", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("investigation.png"),
      fullPage: true,
    });
    await choose("继续故事");
    await choose("进入下一幕");
    await choose("保存群聊转述");
    await choose("向张工核对完整会议纪要");
    await decide(
      publicRoute ? "在例会上公开完整上下文" : "私下纠正转述，暂不公开",
      publicRoute
        ? "让所有看到传言的人也看到完整上下文。"
        : "先在相关人员中纠正，减少继续扩散。",
    );
    await choose("提交实验结果");
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: publicRoute ? "公开事实，守住边界" : "克制纠偏，保留记录",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    const card = page.getByLabel("我的结果卡");
    await expect(card).toContainText(
      publicRoute ? "明确延误责任" : "保留记录不等于原谅",
    );
    await expect(card).toContainText("完整会议纪要");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载结果卡" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("言外之意-我的选择.png");
    await file.saveAs(testInfo.outputPath("result-card.png"));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("ending.png"),
      fullPage: true,
    });
  });
}
