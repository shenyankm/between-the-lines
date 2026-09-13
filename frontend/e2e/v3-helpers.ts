import { expect, type Page } from "@playwright/test";
import type { Action, PlayState } from "../src/types";
export const dialogue = (page: Page) =>
  page.getByRole("textbox", { name: "自由表达", exact: true }).last();
export async function state(page: Page): Promise<PlayState> {
  const id = new URL(page.url()).pathname.split("/").pop();
  const r = await page.request.get(`/api/saves/${id}/play-state`);
  expect(r.ok()).toBe(true);
  return (await r.json()) as PlayState;
}
export async function readScene(page: Page) {
  await expect(page).toHaveURL(/\/play\/[^/]+$/);
  await expect.poll(async () => (await state(page)).active_turn).toBeNull();
  const p = await state(page);
  const node = "node" in p.save.state ? p.save.state.node : "prologue";
  for (
    let index = p.reading?.[node] ?? 0;
    index < (p.performance?.length ?? 0);
    index++
  ) {
    const next = page.getByRole("button").filter({ hasText: "点击继续 →" });
    await expect(next).toBeVisible();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/reading") && r.request().method() === "POST",
    );
    await next.click();
    expect((await saved).ok()).toBe(true);
  }
  await expect(
    page.getByRole("button").filter({ hasText: "点击继续 →" }),
  ).toHaveCount(0);
}
export async function start(page: Page, guest = false) {
  await page.addInitScript(() => {
    window.matchMedia = () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return true;
      },
      media: "",
      onchange: null,
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: guest ? "立即试玩 · 第一幕" : "开发环境试玩" })
    .click();
  if (!guest) await page.getByRole("button", { name: "开始新的故事" }).click();
  await expect(page).toHaveURL(/\/play\//);
  await readScene(page);
  await perform(page, "begin");
  await expect(dialogue(page)).toBeVisible();
}
export async function closePanel(page: Page) {
  const close = page.getByRole("button", { name: "关闭面板" });
  if (await close.isVisible()) await close.click();
}
export async function commitClick(page: Page, click: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.request().method() === "POST",
  );
  await click();
  const r = await response;
  expect(r.ok(), `turn HTTP ${r.status()}`).toBe(true);
  await expect.poll(async () => (await state(page)).active_turn).toBeNull();
}
export async function perform(page: Page, action: Action) {
  await closePanel(page);
  const p = await state(page),
    a = p.available_actions?.find((a) => a.action === action);
  expect(a?.enabled, `${action}: ${a?.reason}`).toBe(true);
  if (
    [
      "request_materials",
      "dispute_return",
      "report",
      "support_project",
      "approve_purchase",
      "joint_review",
      "request_extension",
      "deliver",
      "project_review",
      "correct_loss",
      "confirm_responsibility",
      "change_rules",
      "apply_rules",
    ].includes(action)
  ) {
    await page.getByRole("button", { name: /^工作系统/ }).click();
  } else if (
    [
      "cut_ties",
      "keep_distance",
      "repair_friendship",
      "acknowledge_harm",
      "complete_remedy",
    ].includes(action)
  ) {
    await page.getByRole("button", { name: "关系图", exact: true }).click();
  } else if (
    ["clarify", "review_clarification", "trace_rumor"].includes(action)
  ) {
    await page.getByRole("button", { name: "我的手机", exact: true }).click();
    await page.getByRole("button", { name: /项目工作群/ }).click();
  }
  const label =
    action === "begin"
      ? "进入故事"
      : action === "boundary"
        ? "既然知道我可能会生气，为什么不直接问我？"
        : action === "next"
          ? "带着当前进度进入下一幕 →"
          : action === "close_story"
            ? "按当前进度结束本局"
            : action === "follow_up"
              ? "这次不参加，工作资料请照常发我。"
              : a!.label;
  await commitClick(page, () =>
    page.getByRole("button", { name: label, exact: true }).click(),
  );
  if (a?.requires_confirmation)
    await commitClick(page, () =>
      page.getByRole("button", { name: "确认并提交" }).click(),
    );
  await closePanel(page);
  await readScene(page);
}
export async function supplement(page: Page) {
  await page.getByRole("button", { name: /^工作系统/ }).click();
  const send = page.getByRole("button", { name: "提交所选材料与说明" });
  await expect(send).toBeDisabled();
  await page.getByLabel("报价单", { exact: true }).check();
  await expect(send).toBeDisabled();
  await page.getByLabel("用途说明", { exact: true }).check();
  await commitClick(page, () => send.click());
  await closePanel(page);
  await readScene(page);
}
export async function say(page: Page, text: string) {
  await dialogue(page).fill(text);
  await commitClick(page, () =>
    page.getByRole("button", { name: "发送", exact: true }).last().click(),
  );
  await expect(dialogue(page)).toHaveValue("");
}
export async function exitStory(page: Page) {
  await page.getByRole("button", { name: /^工作系统/ }).click();
  await page.getByRole("button", { name: "人事申请" }).click();
  await page
    .getByLabel("申请理由", { exact: true })
    .fill("经过考虑，我希望离开当前环境。");
  await commitClick(page, () =>
    page.getByRole("button", { name: "保存并预览", exact: true }).click(),
  );
  await commitClick(page, () =>
    page.getByRole("button", { name: "确认提交退出申请", exact: true }).click(),
  );
  await expect(page.getByRole("alertdialog")).toBeVisible();
}
