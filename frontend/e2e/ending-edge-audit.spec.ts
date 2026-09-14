import { test, expect } from "@playwright/test";
import { start, state, perform, exitStory, commitClick } from "./v3-helpers";

test("attending the farewell must not later be described as missing it", async ({
  page,
}, info) => {
  await start(page);
  for (const action of [
    "join_farewell",
    "attend_farewell",
    "next",
    "dispute_return",
    "approve_purchase",
    "next",
    "deliver",
    "clarify",
    "review_clarification",
    "repair_friendship",
    "acknowledge_harm",
    "complete_remedy",
    "project_review",
    "follow_up",
    "close_story",
  ] as const)
    await perform(page, action);
  const save = (await state(page)).save;
  await info.attach("contradictory-save.json", {
    body: JSON.stringify(save, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({
    path: `../artifacts/ending-audit/${info.project.name}-attended-remedy.png`,
    fullPage: true,
  });
  const facts = "work" in save.state ? save.state.work?.facts : {};
  expect(facts?.farewell_attended).toBeTruthy();
  await expect(
    page.getByRole("heading", { name: "有限修复", exact: true }),
  ).toBeVisible();
  const history = await page.request.get(
    `/api/saves/${save.id}/events?limit=100`,
  );
  const events = (await history.json()) as { text: string }[];
  expect(
    events.some((event) => event.text.includes("已经错过的欢送会机会")),
  ).toBe(false);
});

test("submitted exit application stays committed when the ending is reloaded", async ({
  page,
}, info) => {
  await start(page);
  await exitStory(page);
  await commitClick(page, () =>
    page.getByRole("button", { name: "确认并提交" }).click(),
  );
  await expect(
    page.getByRole("heading", { name: "主动转身", exact: true }),
  ).toBeVisible();
  // Completed stories restore the ending, with no active work tools.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "主动转身", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "故事工具与账户" }),
  ).toHaveCount(0);
  const save = (await state(page)).save;
  expect("exit_draft" in save.state && save.state.exit_draft?.submitted).toBe(
    true,
  );
  await page.screenshot({
    path: `../artifacts/ending-audit/${info.project.name}-submitted-exit.png`,
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "申请预览 · 尚未提交", exact: true }),
  ).toHaveCount(0);
});
