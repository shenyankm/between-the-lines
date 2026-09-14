import { expect, test } from "@playwright/test";
import story from "../src/testing/story.json" with { type: "json" };
import { start, state } from "./v3-helpers";

test("legacy input and shared errors preserve unsent text", async ({
  page,
}, info) => {
  await start(page);
  const original = await state(page);
  await page.route("**/play-state", (route) =>
    route.fulfill({
      json: {
        save: {
          ...original.save,
          story_version: 1,
          state: {
            act: 1,
            credit: 60,
            stress: 20,
            heat: 10,
            flags: [],
            procurement: "pending",
            ending: null,
          },
        },
        events: [],
        active_turn: null,
        ai: { available: true, reason: null },
      },
    }),
  );
  await page.route("**/api/story", (route) => route.fulfill({ json: story }));
  await page.route("**/turns", (route) =>
    route.fulfill({
      status: 422,
      json: {
        error: {
          code: "rule_violation",
          message: "请补充具体工作安排。",
          request_id: "ui-fixture",
        },
      },
    }),
  );
  await page.reload();
  const input = page.getByRole("textbox", { name: "对角色说的话" });
  await input.fill("这段话需要保留。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("请补充具体工作安排。")).toBeVisible();
  await expect(input).toHaveValue("这段话需要保留。");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `../artifacts/legacy-ui/${info.project.name}.jpg`,
    fullPage: true,
    quality: 65,
  });
});
