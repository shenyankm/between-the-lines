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
  if (p.save.state.ending) {
    await expect(
      page
        .getByRole("button", { name: "继续", exact: true })
        .or(page.getByRole("region", { name: "故事结局", exact: true })),
    ).toBeVisible();
    if (
      await page
        .getByRole("region", { name: "故事结局", exact: true })
        .isVisible()
    )
      return;
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.getByRole("button", { name: "查看本局结算" }).click();
    return;
  }
  const node = "node" in p.save.state ? p.save.state.node : "prologue";
  const renderedLine = page
    .getByRole("button")
    .filter({ hasText: /点击继续 →|点击显示全文|进入故事/ });
  const shown =
    (await renderedLine.count()) === 1
      ? ((await renderedLine.textContent()) ?? "").replace(/\s+/g, "")
      : "";
  const visibleIndex = shown
    ? (p.performance ?? []).findIndex((line) =>
        shown.includes(line.text.replace(/\s+/g, "")),
      )
    : -1;
  for (
    let index = visibleIndex >= 0 ? visibleIndex : (p.reading?.[node] ?? 0);
    index < (p.performance?.length ?? 0);
    index++
  ) {
    if (p.save.state.act === 0 && index === p.performance!.length - 1) {
      const entry = page.getByRole("button").filter({ hasText: "进入故事" });
      await expect(entry).toBeVisible();
      await commitClick(page, () => entry.click());
      await expect.poll(async () => (await state(page)).save.state.act).toBe(1);
      await readScene(page);
      return;
    }
    const next = page.getByRole("button").filter({ hasText: "点击继续 →" });
    await expect(next).toBeVisible();
    // A response can arrive before React renders the next line. Wait for that
    // line before clicking, and match the exact progress write we are advancing.
    await expect(next).toContainText(p.performance![index]!.text);
    const [saved] = await Promise.all([
      page.waitForResponse((r) => {
        if (!r.url().endsWith("/reading") || r.request().method() !== "POST")
          return false;
        const body = r.request().postDataJSON() as {
          key: string;
          position: number;
        };
        return body.key === node && body.position === index + 1;
      }),
      next.click(),
    ]);
    expect(saved.ok()).toBe(true);
  }
  await expect(
    page.getByRole("button").filter({ hasText: "点击继续 →" }),
  ).toHaveCount(0);
}
export async function start(page: Page, guest = false) {
  // Apply reduced motion to both CSS and JavaScript without changing unrelated
  // viewport/interaction media queries used by the UI component library.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: guest ? "立即试玩 · 第一幕" : "开发环境试玩" })
    .click();
  if (!guest) await page.getByRole("button", { name: "开始新的故事" }).click();
  await expect(page).toHaveURL(/\/play\//);
  await readScene(page);
  await expect(dialogue(page)).toBeVisible();
}
export async function closePanel(page: Page) {
  const back = page.getByRole("button", { name: "返回会话列表" });
  if (await back.isVisible()) await back.click();
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
  let p = await state(page);
  const a = p.available_actions?.find((a) => a.action === action);
  expect(a?.enabled, `${action}: ${a?.reason}`).toBe(true);
  if (
    [
      "next",
      "boundary",
      "appease",
      "join_farewell",
      "attend_farewell",
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
    // These workflow controls were removed from the stage/work UI. Establish
    // domain scenarios through the API; product-v3.spec covers real choice clicks.
    let proposalId: string | undefined;
    if (a?.requires_confirmation) {
      const proposed = await page.request.post(
        `/api/saves/${p.save.id}/turns`,
        {
          data: {
            request_id: crypto.randomUUID(),
            version: p.save.version,
            action: "propose",
            proposed_action: action,
            npc: a.target ?? "sun",
            text: "",
          },
        },
      );
      expect(proposed.ok(), await proposed.text()).toBe(true);
      await expect.poll(async () => (await state(page)).active_turn).toBeNull();
      p = await state(page);
      proposalId = p.proposal?.id;
      expect(proposalId).toBeTruthy();
    }
    const response = await page.request.post(`/api/saves/${p.save.id}/turns`, {
      data: {
        request_id: crypto.randomUUID(),
        version: p.save.version,
        action,
        proposal_id: proposalId,
        npc: a!.target ?? "sun",
        text: "",
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    await expect.poll(async () => (await state(page)).active_turn).toBeNull();
    await page.reload();
    await readScene(page);
    return;
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
    await page.getByRole("button", { name: "回应与协作", exact: true }).click();
  } else if (
    ["clarify", "review_clarification", "trace_rumor"].includes(action)
  ) {
    await page.getByRole("button", { name: "我的手机", exact: true }).click();
    await page.getByRole("button", { name: /研发部工作群/ }).click();
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
  await page.getByLabel("报价单", { exact: true }).check();
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
    .getByRole("textbox", { name: "申请理由", exact: true })
    .fill("经过考虑，我希望离开当前环境。");
  await commitClick(page, () =>
    page.getByRole("button", { name: "保存并预览", exact: true }).click(),
  );
  await commitClick(page, () =>
    page.getByRole("button", { name: "确认提交退出申请", exact: true }).click(),
  );
  await expect(page.getByRole("alertdialog")).toBeVisible();
}

// The sidebar history entry was removed. Keep coverage for existing tabs whose
// saved navigation still points at history, without restoring a product entry.
export async function restoreHistoryPanel(page: Page) {
  await expect(
    page.getByRole("button", { name: "我的手机", exact: true }),
  ).toBeVisible();
  await closePanel(page);
  await page.getByRole("button", { name: "我的手机", exact: true }).click();
  await closePanel(page);
  await page.evaluate(() => {
    const saveId = location.pathname.split("/").pop();
    const key = Object.keys(sessionStorage).find((key) =>
      key.endsWith(`:form:${saveId}:panel-navigation`),
    );
    if (!key) throw new Error("Missing saved panel navigation");
    sessionStorage.setItem(
      key,
      JSON.stringify({ panel: "history", contact: "" }),
    );
  });
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
}
