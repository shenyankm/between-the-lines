import { test, expect } from "@playwright/test";
import {
  start,
  state,
  perform,
  readScene,
  dialogue,
  exitStory,
  commitClick,
  say,
  closePanel,
  supplement,
} from "./v3-helpers";
test("completed choices cannot be resubmitted after refresh", async ({
  page,
}) => {
  await start(page);
  await perform(page, "boundary");
  await page.reload();
  await readScene(page);
  const p = await state(page);
  expect(
    p.available_actions?.find((a) => a.action === "boundary"),
  ).toMatchObject({ enabled: false, completed: true });
  const button = page.getByRole("button", { name: /既然知道我可能会生气/ });
  await expect(button).toBeDisabled();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/turns")) posts++;
  });
  await button.evaluate((b: HTMLButtonElement) => b.click());
  expect(posts).toBe(0);
});
test("procurement prerequisites and actual role permissions remain authoritative", async ({
  page,
}) => {
  await start(page);
  await perform(page, "next");
  const p = await state(page);
  expect(
    p.available_actions?.find((a) => a.action === "approve_purchase")?.enabled,
  ).toBe(false);
  await page.getByRole("button", { name: /^工作系统/ }).click();
  await expect(
    page.getByRole("button", { name: /提交李姐审核/ }),
  ).toBeDisabled();
  await closePanel(page);
  const r = await page.request.post(`/api/saves/${p.save.id}/turns`, {
    data: {
      request_id: crypto.randomUUID(),
      version: p.save.version,
      action: "approve_purchase",
      npc: "zhang",
      channel: "work",
      target: "zhang",
    },
  });
  expect(r.status()).toBe(422);
  expect((await state(page)).save.state).toEqual(p.save.state);
  await supplement(page);
  await perform(page, "approve_purchase");
  await perform(page, "next");
  await perform(page, "deliver");
  expect((await state(page)).save.state.flags).toContain("delivered");
});
test("phone, private drafts, suggestions and history preserve unrelated progress", async ({
  page,
}) => {
  await start(page);
  await dialogue(page).fill("现场未发送的草稿");
  const before = await state(page);
  await page.getByRole("button", { name: "我的手机" }).click();
  await page.getByRole("button", { name: /王会计/ }).click();
  await dialogue(page).fill("王会计你好，祝一切顺利。");
  await page.getByRole("button", { name: "关闭面板" }).click();
  expect(await dialogue(page).inputValue()).toBe("现场未发送的草稿");
  await page.getByRole("button", { name: "知乎众议" }).click();
  await expect(page.getByText(/私人对话不会用于搜索/)).toBeVisible();
  await closePanel(page);
  expect((await state(page)).save.state).toEqual(before.save.state);
  await page.getByRole("button", { name: "我的手机" }).click();
  await page.getByRole("button", { name: /王会计/ }).click();
  await expect(dialogue(page)).toHaveValue("王会计你好，祝一切顺利。");
  await say(page, "王会计你好，祝一切顺利。");
  await closePanel(page);
  await page.getByRole("button", { name: "完整记录" }).click();
  await expect(
    page
      .getByRole("region", { name: "完整历史记录" })
      .getByText("王会计你好，祝一切顺利。", { exact: true }),
  ).toHaveCount(1);
});
for (const act of [1, 2, 3])
  test(`leave from act ${act}, cancel first and reload the factual ending`, async ({
    page,
  }) => {
    await start(page);
    for (let i = 1; i < act; i++) await perform(page, "next");
    await exitStory(page);
    expect((await state(page)).save.state.ending).toBeNull();
    await commitClick(page, () =>
      page.getByRole("button", { name: "暂不执行" }).click(),
    );
    expect((await state(page)).save.state.ending).toBeNull();
    await exitStory(page);
    await commitClick(page, () =>
      page.getByRole("button", { name: "确认并提交" }).click(),
    );
    await expect(
      page.getByRole("heading", { name: "主动转身", exact: true }),
    ).toBeVisible();
    const finished = (await state(page)).save.state;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "主动转身", exact: true }),
    ).toBeVisible();
    expect((await state(page)).save.state).toEqual(finished);
    await expect(dialogue(page)).toHaveCount(0);
  });
test("independent saves, continuation, logout and another identity do not mix", async ({
  page,
}) => {
  await start(page);
  await perform(page, "boundary");
  const first = page.url(),
    before = (await state(page)).save;
  await page.getByRole("link", { name: "言外之意", exact: true }).click();
  await page.getByRole("link", { name: "继续上次的故事" }).click();
  await expect(page).toHaveURL(first);
  await page.getByRole("link", { name: "言外之意", exact: true }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await expect(page).toHaveURL(/\/play\//);
  await expect(page).not.toHaveURL(first);
  await readScene(page);
  expect((await state(page)).save.state.flags).not.toContain("boundary:act_1");
  await page.goto("/saves");
  await expect(
    page.getByRole("link", { name: "打开故事", exact: true }),
  ).toHaveCount(2);
  await page.goto(first);
  await readScene(page);
  expect((await state(page)).save.state).toEqual(before.state);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("link", { name: "查看全部存档" }).click();
  await expect(page.getByText("还没有故事，从第一句话开始。")).toBeVisible();
  await page.goto(first);
  await expect(page.getByRole("alert")).toContainText("存档不存在");
});
test("double clicks and whitespace never create extra actions", async ({
  page,
}) => {
  await start(page);
  await dialogue(page).fill("   ");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  const before = await state(page);
  await page
    .getByRole("button", { name: /既然知道我可能会生气/ })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect
    .poll(async () => (await state(page)).save.version)
    .toBe(before.save.version + 1);
  expect(
    (await state(page)).events.filter((e) => e.action === "boundary"),
  ).toHaveLength(1);
});
test("two tabs reconcile a stale version without losing drafts or duplicating facts", async ({
  page,
  context,
}) => {
  await start(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await readScene(second);
  await dialogue(second).fill("保留这段草稿");
  await perform(page, "boundary");
  const rejected = second.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.status() === 409,
  );
  await second.getByRole("button", { name: /既然知道我可能会生气/ }).click();
  await rejected;
  await expect(dialogue(second)).toHaveValue("保留这段草稿");
  await expect(
    second.getByRole("button", { name: /既然知道我可能会生气/ }),
  ).toBeDisabled();
  await say(second, "保留这段草稿");
  expect(
    (await state(second)).events.filter((e) => e.action === "boundary"),
  ).toHaveLength(1);
  await second.close();
});
