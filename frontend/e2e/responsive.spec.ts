import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { responsiveFixture } from "./responsive-fixtures";

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const modal = page.locator("dialog[open]");
  if (await modal.count())
    expect(
      await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({
    path: `../artifacts/responsive/${info.project.name}-${name}.jpg`,
    fullPage: (await page.locator("dialog[open]").count()) === 0,
    quality: 65,
  });
}
async function inViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
}

test("stage regions never overlap at supported widths and breakpoint boundaries", async ({
  page,
}, info) => {
  const fixture = await responsiveFixture(page);
  await fixture.stage();
  const widths = [
    320, 390, 539, 540, 541, 599, 600, 601, 699, 700, 701, 768, 849, 850, 851,
    899, 900, 901, 999, 1000, 1001, 1280, 1440, 1499, 1500, 1501, 1920, 2560,
  ];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    const toolbar = page.getByRole("navigation", { name: "故事工具与账户" });
    const portraits = page.locator('[class*="portraits"]');
    const a = (await toolbar.boundingBox())!,
      b = (await portraits.boundingBox())!;
    const overlap =
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
    expect(overlap, `portraits and tools at ${width}px`).toBe(false);
    for (const button of await toolbar.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    if ([320, 390, 768, 1280, 1440, 1920, 2560].includes(width))
      await capture(page, info, `stage-${width}`);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => scrollTo(0, 0));
  await noOverflow(page);
  expect(
    (await page.locator('[class*="dialogue_"]').first().boundingBox())!.y,
  ).toBeLessThan(390);
  await capture(page, info, "landscape");
  // Text enlargement supplements narrow CSS viewport checks; it is not physical device zoom.
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await noOverflow(page);
  await page.getByRole("button", { name: "我的手机", exact: true }).click();
  await noOverflow(page);
  await page.keyboard.press("Escape");
});

test("all five panels keep close controls and feedback reachable", async ({
  page,
}, info) => {
  await (await responsiveFixture(page)).stage();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    "我的手机",
    "工作系统",
    "关系图",
    "知乎众议",
    "完整记录",
  ]) {
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await noOverflow(page);
    await inViewport(dialog.getByRole("button", { name: "关闭面板" }), page);
    if (name === "工作系统") {
      await dialog
        .getByRole("button", { name: "人事申请", exact: true })
        .click();
      const colors = await dialog
        .getByRole("combobox")
        .first()
        .evaluate((el) => ({
          fg: getComputedStyle(el).color,
          bg: getComputedStyle(el).backgroundColor,
        }));
      const luminance = (rgb: string) =>
        rgb
          .match(/\d+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
          .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0);
      const fg = luminance(colors.fg),
        bg = luminance(colors.bg);
      expect(
        (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
      await dialog
        .getByRole("textbox", { name: "原因", exact: true })
        .fill("请求协作支持");
      await dialog
        .getByRole("textbox", { name: "交接或分工安排", exact: true })
        .fill("先确认任务安排");
      await dialog
        .getByRole("button", { name: "保存并预览申请", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        "请补充具体的工作安排。",
      );
      await inViewport(dialog.getByRole("alert"), page);
      await expect(
        dialog.getByRole("textbox", { name: "原因", exact: true }),
      ).toHaveValue("请求协作支持");
      await capture(page, info, "hr-error");
    } else {
      if (name === "完整记录")
        await expect(dialog.getByText("本局还没有记录。")).toBeVisible();
      if (name === "知乎众议")
        await expect(
          dialog.getByText("先核实，再回应", { exact: true }),
        ).toBeVisible();
      await capture(page, info, `panel-${name}`);
    }
    await dialog
      .locator('[class*="drawerBody"]')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await inViewport(dialog.getByRole("button", { name: "关闭面板" }), page);
    // Native dialog may move focus to browser chrome, but never to inert page controls.
    await dialog.getByRole("button", { name: "关闭面板" }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          !!document.activeElement?.closest("dialog"),
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("long confirmation starts at the title with independently scrolling content", async ({
  page,
}, info) => {
  const { view } = await responsiveFixture(page);
  view.play.proposal = {
    id: "proposal",
    version: 2,
    action: "submit_exit",
    label: "确认提交退出申请",
    effect: "提交表示开始申请，不代表手续完成。",
  };
  if ("exit_draft" in view.play.save.state)
    view.play.save.state.exit_draft = {
      kind: "resign",
      reason: "经过考虑，我希望调整工作安排并完成交接。".repeat(40),
      submitted: false,
      event_id: "draft",
    };
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto("/play/responsive-save");
    const dialog = page.getByRole("alertdialog");
    const heading = dialog.getByRole("heading", { name: "确认提交退出申请" });
    await expect(heading).toBeFocused();
    await inViewport(heading, page);
    await inViewport(dialog.getByRole("button", { name: "暂不执行" }), page);
    const body = dialog.locator('[class*="confirmBody"]');
    expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await inViewport(heading, page);
    await noOverflow(page);
    await capture(page, info, `confirmation-${width}`);
  }
});

test("home saves endings and legacy pages handle empty and long content", async ({
  page,
}, info) => {
  const fixture = await responsiveFixture(page);
  const { view } = fixture;
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "开始新的故事" }),
    ).toBeVisible();
    await noOverflow(page);
    await capture(page, info, `home-${width}`);
    for (const count of [0, 1, 2, 5, 7]) {
      view.count = count;
      await page.goto("/saves");
      await expect(page.getByRole("link", { name: "打开故事" })).toHaveCount(
        count,
      );
      if (!count)
        await expect(
          page.getByText("还没有故事，从第一句话开始。"),
        ).toBeVisible();
      await noOverflow(page);
      if (count === 5) await capture(page, info, `saves-${width}`);
    }
  }
  view.long = true;
  view.play.save.state.ending = "professional_boundary";
  if ("outcome" in view.play.save.state)
    view.play.save.state.outcome = {
      id: "professional_boundary",
      key_event_ids: [],
      title: "各自为界",
      achievements: ["已留下的专业记录。".repeat(30)],
      unresolved: ["待处理的工作事项。".repeat(30)],
    };
  for (const status of ["running", "completed", "failed", "unknown"]) {
    view.jobStatus = status;
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/play/responsive-save");
      await expect(
        page.getByRole("region", { name: "已保存事实", exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await capture(page, info, `ending-${status}-${width}`);
    }
  }
  await page.goto("/saves");
  await expect(page.getByText("各自为界", { exact: true })).toHaveCount(
    view.count,
  );
  await expect(
    page.getByText("professional_boundary", { exact: true }),
  ).toHaveCount(0);
  fixture.legacy();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 650 });
    await page.goto("/play/responsive-save");
    await expect(
      page.getByRole("textbox", { name: "对角色说的话" }),
    ).toBeVisible();
    await noOverflow(page);
    await capture(page, info, `legacy-${width}`);
    await page.getByRole("button", { name: "手机", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "手机", exact: true });
    await dialog
      .locator('[class*="drawerBody"]')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await inViewport(dialog.getByRole("button", { name: "关闭面板" }), page);
    await noOverflow(page);
    await capture(page, info, `legacy-panel-${width}`);
    await page.keyboard.press("Escape");
  }
  view.play.save.read_only = true;
  await page.goto("/play/responsive-save");
  await expect(
    page.getByRole("heading", { name: "旧版故事 · 只读历史" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await noOverflow(page);
  await capture(page, info, "read-only");
});

test("long stage history and interlude remain usable with terminal discussion states", async ({
  page,
}, info) => {
  const fixture = await responsiveFixture(page);
  const { view } = fixture;
  view.story.acts[1]!.interlude = {
    image: view.story.acts[1]!.background,
    location: "幕间审查场景",
    time: "夜间",
    text: "给自己留下思考与回应的空间。".repeat(50),
  };
  view.story.acts[1]!.title =
    "在关系与工作之间，认真确认每一个尚未说清的选择。".repeat(6);
  view.play.performance![0]!.text = "先确认事实，再表达自己的边界。".repeat(50);
  view.play.events = Array.from({ length: 30 }, (_, i) => ({
    id: `history-${i}`,
    kind: "npc",
    npc: "sun",
    act: 1,
    channel: "scene",
    text: `记录 ${i + 1}：${"这是一段需要完整阅读的对白。".repeat(12)}`,
  }));
  for (const [width, height] of [
    [320, 844],
    [844, 390],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await fixture.stage();
    await noOverflow(page);
    await capture(page, info, `long-stage-${width}`);
    const trigger = page.getByRole("button", { name: "完整记录", exact: true });
    await trigger.press("Space");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("article")).toHaveCount(30);
    await dialog
      .locator('[class*="drawerBody"]')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await inViewport(dialog.getByRole("button", { name: "关闭面板" }), page);
    await noOverflow(page);
    await capture(page, info, `long-history-${width}`);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page
      .getByRole("button", { name: "带着当前进度进入下一幕 →", exact: true })
      .click();
    const interlude = page.getByRole("dialog");
    await expect(interlude).toBeVisible();
    await inViewport(
      interlude.getByRole("button", { name: "返回当前剧情" }),
      page,
    );
    await interlude
      .locator('[class*="interludeBody"]')
      .evaluate((el) => (el.scrollTop = 0));
    await noOverflow(page);
    await capture(page, info, `interlude-${width}`);
    await page.keyboard.press("Escape");
  }
  for (const status of ["running", "failed", "unknown"]) {
    view.jobStatus = status;
    await fixture.stage();
    await page.getByRole("button", { name: "知乎众议", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      status === "running" ? "正在整理来源" : "本次观点整理未完成",
    );
    await noOverflow(page);
    await capture(page, info, `discussion-${status}`);
  }
});
