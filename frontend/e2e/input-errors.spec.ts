import { expect, test } from "@playwright/test";
import { dialogue, start } from "./v3-helpers";

test("v3 input and shared errors preserve unsent text", async ({
  page,
}, info) => {
  await start(page);
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
  const input = dialogue(page);
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
    path: `../artifacts/input-errors/${info.project.name}.jpg`,
    fullPage: true,
    quality: 65,
  });
});
