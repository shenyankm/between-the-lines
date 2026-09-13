import { test, expect, type Page } from "@playwright/test";
import type { PlayState } from "../src/types";

const dialogue = (page: Page) =>
  page.getByRole("textbox", { name: "对角色说的话" });
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.getByRole("button", { name: "进入故事" }).click();
  await expect(dialogue(page)).toBeEnabled();
}
async function state(page: Page) {
  const id = new URL(page.url()).pathname.split("/").pop();
  const response = await page.request.get(`/api/saves/${id}/play-state`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as PlayState;
}

test("completed choices cannot be resubmitted, including after refresh", async ({
  page,
}, info) => {
  await start(page);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/turns"))
      posts++;
  });
  await page.getByRole("button", { name: "明确表达我的边界" }).click();
  await expect(dialogue(page)).toBeEnabled();
  const choice = page.getByRole("button", { name: /明确表达我的边界/ });
  await expect(choice).toBeDisabled();
  await expect(choice).toContainText("已完成");
  await choice.evaluate((button: HTMLButtonElement) => button.click());
  expect(posts).toBe(1);
  await page.reload();
  await expect(choice).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续故事" })).toBeEnabled();
  await page.screenshot({
    path: `../artifacts/${info.project.name}-completed-choice.png`,
    fullPage: true,
    animations: "disabled",
  });
});

async function say(page: Page, text: string) {
  await dialogue(page).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialogue(page)).toHaveValue("");
  await expect(dialogue(page)).toBeEnabled();
}
async function select(page: Page, name: string) {
  await page.getByRole("button", { name: "手机", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
}
async function advance(page: Page, location: string) {
  await page.getByRole("button", { name: "继续故事" }).click();
  await page.getByRole("button", { name: "进入下一幕" }).click();
  await expect(page.getByRole("heading", { name: location })).toBeVisible();
}
async function finance(page: Page) {
  await page.getByRole("button", { name: "明确表达我的边界" }).click();
  await expect(dialogue(page)).toBeEnabled();
  await advance(page, "财务窗口");
}
async function meeting(page: Page) {
  await finance(page);
  await select(page, "李姐");
  await say(page, "请明确采购材料要求。");
  await page.getByRole("button", { name: "补齐采购材料" }).click();
  await expect(dialogue(page)).toBeEnabled();
  await say(page, "材料齐全，请审核采购。");
  await advance(page, "项目会议室");
}

for (const label of ["私信祝福王会计", "明确表达我的边界", "当众质问孙淼"]) {
  test(`each first-act response independently advances: ${label}`, async ({
    page,
  }) => {
    await start(page);
    await expect(page.getByRole("button", { name: "继续故事" })).toBeDisabled();
    await page.getByRole("button", { name: label }).click();
    await expect(dialogue(page)).toBeEnabled();
    await expect(
      page.getByRole("button", { name: new RegExp(label) }),
    ).toBeDisabled();
    await advance(page, "财务窗口");
    expect((await state(page)).save.state.act).toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("procurement prerequisites, actual role permissions and reverse-order delivery all work", async ({
  page,
}) => {
  await start(page);
  await finance(page);
  const next = page.getByRole("button", { name: "继续故事" });
  const supplement = page.getByRole("button", { name: /补齐采购材料/ });
  await expect(next).toBeDisabled();
  await expect(supplement).toBeDisabled();
  await expect(
    page.getByText("先与孙淼或李姐对话，确认材料要求。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "向张工同步进度" }).click();
  await expect(dialogue(page)).toBeEnabled();
  expect((await state(page)).save.state.flags).not.toContain("supported");
  await say(page, "请支持项目，并帮我批准采购。");
  let current = (await state(page)).save.state;
  expect(current.flags).toContain("supported");
  expect(current.procurement).toBe("pending");
  await select(page, "孙淼");
  await say(page, "请列出所需材料。");
  await expect(supplement).toBeEnabled();
  await supplement.click();
  await expect(supplement).toBeDisabled();
  await expect(supplement).toContainText("已完成");
  await say(page, "请你直接批准采购。");
  expect((await state(page)).save.state.procurement).toBe("pending");
  await expect(next).toBeDisabled();
  await select(page, "李姐");
  await say(page, "材料已经补齐，请审核。");
  await expect(next).toBeEnabled();
  const before = await state(page);
  await next.click();
  await page.getByRole("button", { name: "返回当前剧情" }).click();
  expect((await state(page)).save).toEqual(before.save);
  await advance(page, "项目会议室");
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "提交实验结果" }).click();
  await expect(dialogue(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: /结束与孙淼/ })).toHaveCount(0);
  await page.getByRole("button", { name: "在例会上澄清传言" }).click();
  await expect(dialogue(page)).toBeEnabled();
  await page
    .getByRole("button", { name: "结束与孙淼的私人来往，仅保留工作沟通" })
    .click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "找回自我 · 只留工作往来" }),
  ).toBeVisible();
  current = (await state(page)).save.state;
  expect(current.flags).toContain("sun_cut");
  expect(current.flags).not.toContain("sun_observe");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("phone, private reply, tips, history and interlude cancellation preserve progress", async ({
  page,
}) => {
  await start(page);
  const before = await state(page);
  await page.getByRole("button", { name: "手机", exact: true }).click();
  await expect(page.getByText(/王叔的私人回复/)).toHaveCount(0);
  await expect(page.getByText(/前男友。/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "锦囊", exact: true }).click();
  await expect(page.getByRole("heading", { name: "先确认事实" })).toBeVisible();
  await page.getByRole("button", { name: "关闭面板" }).click();
  expect((await state(page)).save).toEqual(before.save);
  await page.getByRole("button", { name: "私信祝福王会计" }).click();
  await expect(dialogue(page)).toBeEnabled();
  await page.getByRole("button", { name: "手机", exact: true }).click();
  await expect(page.getByText(/王叔的私人回复/)).toBeVisible();
  await expect(page.getByRole("button", { name: /王叔/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "回顾", exact: true }).click();
  await expect(page.getByText("王叔 · 私人回复")).toBeVisible();
  await page.keyboard.press("Escape");
  const contacted = await state(page);
  await page.getByRole("button", { name: "继续故事" }).click();
  await page.keyboard.press("Escape");
  expect((await state(page)).save).toEqual(contacted.save);
  await select(page, "李姐");
  await say(page, "你好");
  const events = (await state(page)).events;
  expect(events.filter((e) => e.kind === "personal")).toHaveLength(1);
  expect(
    events.filter((e) => e.kind === "npc" && e.npc === "li").at(-1)?.text,
  ).not.toContain("王叔");
});

for (const act of [1, 2, 3]) {
  test(`leave from act ${act}, cancel first, and reload the ending`, async ({
    page,
  }) => {
    await start(page);
    if (act === 2) await finance(page);
    if (act === 3) await meeting(page);
    const before = await state(page);
    await page.getByRole("button", { name: "工作系统", exact: true }).click();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "选择离开当前环境" }).click();
    expect((await state(page)).save).toEqual(before.save);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "选择离开当前环境" }).click();
    await expect(page.getByRole("heading", { name: "主动离开" })).toBeVisible();
    await expect(page.getByText(/你为这段经历选择了/)).toBeVisible();
    const after = await state(page);
    expect(after.save.state.flags.includes("personal_resolved")).toBe(
      act === 3,
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "主动离开" })).toBeVisible();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "继续故事" })).toHaveCount(0);
    await page.getByRole("link", { name: "回看我的故事" }).click();
    await expect(page.getByRole("heading", { name: "我的故事" })).toBeVisible();
    await page.getByRole("link", { name: /主动离开/ }).click();
    await expect(page.getByRole("heading", { name: "主动离开" })).toBeVisible();
  });
}

test("independent saves, home continuation, logout and another identity do not mix", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "私信祝福王会计" }).click();
  await expect(dialogue(page)).toBeEnabled();
  const first = page.url();
  const firstState = (await state(page)).save;
  await page.getByRole("link", { name: "言外之意" }).click();
  await page.getByRole("link", { name: "继续上次的故事" }).click();
  expect(page.url()).toBe(first);
  await page.getByRole("link", { name: "言外之意" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await expect(page.getByRole("button", { name: "进入故事" })).toBeVisible();
  expect((await state(page)).save.state.flags).not.toContain("wang_contacted");
  await page.getByRole("link", { name: "存档", exact: true }).click();
  await expect(page.getByRole("link", { name: /故事 \d/ })).toHaveCount(2);
  await page.goto(first);
  await expect(dialogue(page)).toBeEnabled();
  expect((await state(page)).save).toEqual(firstState);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("button", { name: "开发环境试玩" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("link", { name: "查看全部存档" }).click();
  await expect(page.getByText("还没有故事，从第一句话开始。")).toBeVisible();
  await page.goto(first);
  await expect(page.getByRole("alert")).toContainText("存档不存在");
  await expect(dialogue(page)).toHaveCount(0);
});

test("double clicks and whitespace never create extra actions", async ({
  page,
}) => {
  await start(page);
  const before = await state(page);
  await dialogue(page).fill("   ");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await dialogue(page).press("Enter");
  expect((await state(page)).save).toEqual(before.save);
  await page
    .getByRole("button", { name: "当众质问孙淼" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(dialogue(page)).toBeEnabled();
  const after = await state(page);
  expect(after.save.version).toBe(before.save.version + 1);
  expect(
    after.events.filter((e) => e.action === "public_confront"),
  ).toHaveLength(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("two tabs reconcile a stale version without losing drafts or duplicating facts", async ({
  page,
  context,
}) => {
  await start(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(dialogue(second)).toBeEnabled();
  await dialogue(second).fill("保留这段草稿");
  await page.getByRole("button", { name: "明确表达我的边界" }).click();
  await expect(dialogue(page)).toBeEnabled();
  const rejection = second.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.status() === 409,
  );
  await second.getByRole("button", { name: "私信祝福王会计" }).click();
  await rejection;
  await expect(dialogue(second)).toHaveValue("保留这段草稿");
  await expect(
    second.getByRole("button", { name: /明确表达我的边界/ }),
  ).toBeDisabled();
  await second.getByRole("button", { name: "私信祝福王会计" }).click();
  await expect(dialogue(second)).toBeEnabled();
  const result = await state(second);
  expect(result.events.filter((e) => e.action === "boundary")).toHaveLength(1);
  expect(result.events.filter((e) => e.action === "contact_wang")).toHaveLength(
    1,
  );
  await expect(second.getByRole("alert")).toHaveCount(0);
  await second.close();
});
