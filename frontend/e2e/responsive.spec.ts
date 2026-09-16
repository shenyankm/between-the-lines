import { restoreHistoryPanel } from "./v3-helpers";
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

test("all four panels keep close controls and feedback reachable", async ({
  page,
}, info) => {
  await (await responsiveFixture(page)).stage();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["我的手机", "工作系统", "关系图", "知乎众议"]) {
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const modalBox = (await dialog.boundingBox())!;
    expect(
      Math.abs(
        modalBox.x + modalBox.width / 2 - page.viewportSize()!.width / 2,
      ),
    ).toBeLessThan(2);
    expect(modalBox.x).toBeGreaterThan(0);
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
    if (name !== "知乎众议") {
      expect(
        await page.evaluate(
          () =>
            document.activeElement === document.body ||
            !!document.activeElement?.closest("dialog"),
        ),
      ).toBe(true);
    } else {
      expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(false);
    }
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
        Math.min(count, 6),
      );
      if (count === 7)
        await expect(page.getByText("第 1 / 2 页")).toBeVisible();
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
        page
          .getByRole("button", { name: "继续", exact: true })
          .or(page.getByRole("region", { name: "故事结局", exact: true })),
      ).toBeVisible();
      if (
        await page
          .getByRole("button", { name: "继续", exact: true })
          .isVisible()
      ) {
        await page.getByRole("button", { name: "继续", exact: true }).click();
        await page.getByRole("button", { name: "查看本局结算" }).click();
      }
      await expect(
        page.getByRole("img", { name: /各自为界：文档原版/ }),
      ).toBeVisible();
      await noOverflow(page);
      await capture(page, info, `ending-${status}-${width}`);
    }
  }
  await page.goto("/saves");
  await expect(page.getByText("各自为界", { exact: true })).toHaveCount(6);
  await expect(
    page.getByText("professional_boundary", { exact: true }),
  ).toHaveCount(0);
  fixture.legacy();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 650 });
    await page.goto("/play/responsive-save");
    await expect(
      page.getByRole("heading", { name: "旧版故事 · 只读历史" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByText(view.play.save.scene_intro!)).toBeVisible();
    await expect(page.getByText("本局还没有记录。")).toBeVisible();
    await noOverflow(page);
    await capture(page, info, `legacy-${width}`);
  }
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
    await restoreHistoryPanel(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("article")).toHaveCount(30);
    await dialog
      .locator('[class*="drawerBody"]')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await inViewport(dialog.getByRole("button", { name: "关闭面板" }), page);
    await noOverflow(page);
    await capture(page, info, `long-history-${width}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", {
        name: "带着当前进度进入下一幕 →",
        exact: true,
      }),
    ).toHaveCount(0);
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
    await page.keyboard.press("Escape");
  }
});

test("phone reference layout preserves context, portraits, and a reachable composer", async ({
  page,
}, info) => {
  const fixture = await responsiveFixture(page);
  fixture.view.play.performance![0]!.portraits = ["player", "sun"];
  await fixture.stage();
  for (const width of [390, 600, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "我的手机", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "通讯" })).toBeVisible();
    const names = await dialog
      .locator('[class*="contactText"] strong')
      .allTextContents();
    expect(names).toEqual(["孙淼", "王会计", "李姐", "张工", "研发部工作群"]);
    const loaded = await dialog
      .locator("img")
      .evaluateAll((images) =>
        images.every(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
      );
    if (!loaded)
      await expect
        .poll(() =>
          dialog
            .locator("img")
            .evaluateAll((images) =>
              images.every(
                (image) => (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        )
        .toBe(true);
    await page.screenshot({
      path: `../artifacts/phone-reference/${info.project.name}-${width}-contacts.png`,
    });
    await dialog.getByRole("button", { name: "张工", exact: true }).click();
    await expect(
      dialog.getByText("暂无聊天记录", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText(/当前情景.*第一幕/)).toHaveCount(0);
    await expect(dialog.getByText(/项目最近怎么样/)).toHaveCount(0);
    await dialog
      .getByRole("textbox", { name: "自由表达" })
      .fill("我想确认欢送会的安排。".repeat(12));
    await inViewport(
      dialog.getByRole("button", { name: "发送", exact: true }),
      page,
    );
    await noOverflow(page);
    await page.screenshot({
      path: `../artifacts/phone-reference/${info.project.name}-${width}-empty.png`,
    });
    await dialog.getByRole("button", { name: "返回会话列表" }).click();
    await dialog.getByRole("button", { name: "关闭面板" }).click();
    await expect(
      page.getByRole("button", { name: "我的手机", exact: true }),
    ).toBeFocused();
  }
  expect(fixture.view.turns).toBe(0);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.screenshot({
    path: `../artifacts/phone-reference/${info.project.name}-stage.png`,
  });
  fixture.view.play.events = [
    {
      id: "message-1",
      kind: "npc",
      npc: "sun",
      speaker: "sun",
      channel: "dm",
      text: "欢送会的安排，我们再确认一下。",
    },
    {
      id: "message-2",
      kind: "player",
      npc: "sun",
      speaker: "player",
      channel: "dm",
      text: "我希望能直接收到通知。",
    },
  ];
  await page.getByRole("button", { name: "我的手机", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "孙淼", exact: true })
    .click();
  await expect(
    page.getByText("我希望能直接收到通知。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("暂无聊天记录", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `../artifacts/phone-reference/${info.project.name}-chat.png`,
  });
  await page.setViewportSize({ width: 390, height: 450 });
  await inViewport(
    page.getByRole("dialog").getByRole("button", { name: "发送", exact: true }),
    page,
  );
  await noOverflow(page);
  await page.goto("/");
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(
    page.getByRole("button", { name: "开始新的故事" }),
  ).toBeVisible();
  await page.screenshot({
    path: `../artifacts/phone-reference/${info.project.name}-home.png`,
  });
});

test("work and discussion references keep real records and responsive cards", async ({
  page,
}, info) => {
  const fixture = await responsiveFixture(page);
  Object.assign(fixture.view.play.save.state, {
    act: 2,
    node: "act_2",
    content_revision: 3,
    work: {
      purchase: "returned",
      facts: {},
      submissions: [
        {
          kind: "standard",
          version: 1,
          purpose: "实验耗材采购原始申请",
          evidence: ["quote"],
          event_id: "submission-fixture",
          status: "returned",
          feedback: "请补充用途说明。",
        },
      ],
      reviews: [
        {
          version: 1,
          actor: "sun",
          decision: "退回",
          detail: "请补充用途说明。",
          time: "本幕",
          event_id: "review-fixture",
        },
      ],
    },
  });
  fixture.view.play.reading = { act_2: 1 };
  await fixture.stage();
  await expect(
    page.getByRole("button", { name: "工作系统 · 未读", exact: true }),
  ).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: /^工作系统/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "试制材料采购 已退回" }),
    ).toBeVisible();
    await expect(
      dialog
        .getByLabel("审批与提交记录")
        .getByText("实验耗材采购原始申请", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("审批与提交记录")).toContainText(
      "请补充用途说明。",
    );
    await inViewport(
      dialog.getByRole("button", { name: "提交所选材料与说明" }),
      page,
    );
    const form = (await dialog.getByLabel("采购申请表").boundingBox())!;
    const reviews = (await dialog.getByLabel("审批与提交记录").boundingBox())!;
    if (width > 800) {
      expect(reviews.x).toBeGreaterThan(form.x + form.width);
      expect(form.width / reviews.width).toBeGreaterThan(1.5);
    }
    await noOverflow(page);
    await page.screenshot({
      path: `../artifacts/phone-reference/${info.project.name}-${width}-work.png`,
    });
    await dialog.getByRole("button", { name: "关闭面板" }).click();
    await expect(
      page.getByRole("button", { name: "工作系统 · 待处理", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "知乎众议", exact: true }).click();
    await expect(
      dialog.getByText("先核实，再回应", { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("blockquote")).toHaveText(
      "我想先确认具体安排。",
    );
    await noOverflow(page);
    await page.screenshot({
      path: `../artifacts/phone-reference/${info.project.name}-${width}-discussion.png`,
    });
    await dialog.getByRole("button", { name: "关闭面板" }).click();
  }
  expect(fixture.view.turns).toBe(0);
});

test("completed scene receipts leave no blank block above phone contacts", async ({
  page,
}) => {
  const fixture = await responsiveFixture(page);
  fixture.view.play.events = [
    {
      id: "completed-input",
      kind: "player",
      npc: "sun",
      speaker: "player",
      channel: "scene",
      action: "begin",
      text: "进入故事",
    },
  ];
  await fixture.stage();
  await expect(
    page.getByText("最近一轮 · 已保存记录", { exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: "../artifacts/phone-reference/clean-stage.png",
  });
  await restoreHistoryPanel(page);
  await expect(
    page
      .getByRole("dialog")
      .getByText("最近一轮 · 已保存记录", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "我的手机", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("操作反馈")).toBeHidden();
  const header = (await dialog.locator("header").boundingBox())!;
  const contact = (await dialog
    .getByRole("button", { name: "孙淼", exact: true })
    .boundingBox())!;
  expect(contact.y - header.y - header.height).toBeLessThan(24);
});

test("tool modals dismiss on the backdrop without dismissing inside clicks or drags", async ({
  page,
}) => {
  await (await responsiveFixture(page)).stage();
  for (const name of ["我的手机", "工作系统", "关系图", "知乎众议"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#story-panel-title").click();
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
    if (name === "知乎众议") {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
    } else {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeFocused();
    }
  }
});
