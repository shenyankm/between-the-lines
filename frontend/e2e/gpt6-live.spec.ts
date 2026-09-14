import { expect, test } from "@playwright/test";
import { dialogue, start, state, exitStory, commitClick } from "./v3-helpers";
import type { Turn, TurnInput } from "../src/types";

test("GPT6 replies and generates a grounded ending through the real app", async ({
  page,
}) => {
  test.skip(
    process.env.BTL_LIVE_GPT6 !== "1",
    "Explicit opt-in: consumes gateway credits",
  );
  test.setTimeout(180_000);
  const config = await page.request.get("/api/config");
  expect(await config.json()).toMatchObject({
    agent_mode: "openai",
    model_ready: true,
  });
  await start(page);
  const before = await state(page);
  const priorEvents = new Set(before.events.map((event) => event.id));
  await dialogue(page).fill("我想先听清楚，你刚刚那句话具体是什么意思？");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/turns"),
  );
  await page.getByRole("button", { name: "发送", exact: true }).last().click();
  const requestId = ((await submitted).postDataJSON() as TurnInput).request_id;
  await expect(dialogue(page)).toHaveValue("", { timeout: 90_000 });
  await expect
    .poll(async () => (await state(page)).active_turn, { timeout: 90_000 })
    .toBeNull();
  const after = await state(page);
  const response = await page.request.get(
    `/api/saves/${after.save.id}/turns/${requestId}`,
  );
  expect(response.ok()).toBe(true);
  const turn = (await response.json()) as Turn;
  expect(turn.status).toBe("completed");
  expect(turn.usage).toMatchObject({ mode: "openai", model: "gpt-6-astra" });
  expect(turn.usage.model_calls).toBeGreaterThan(0);
  expect(turn.usage.total_tokens).toBeGreaterThan(0);
  expect(
    after.events.some(
      (event) =>
        !priorEvents.has(event.id) &&
        event.kind === "npc" &&
        event.text.trim().length > 0,
    ),
  ).toBe(true);
  await exitStory(page);
  await commitClick(page, () =>
    page.getByRole("button", { name: "确认并提交" }).click(),
  );
  await expect(
    page.getByRole("heading", { name: "结局正文", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("结局演出 · AI 生成", { exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("本次生成未完成", { exact: false })).toHaveCount(
    0,
  );
});
