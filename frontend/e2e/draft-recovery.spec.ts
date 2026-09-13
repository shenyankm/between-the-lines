import { start } from "./v3-helpers";
import { test, expect } from "@playwright/test";

test("successful background recovery clears only the submitted draft", async ({
  page,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "自由表达" });
  await expect(input).toBeEnabled();
  let posts = 0;
  await page.route("**/api/saves/*/turns", async (route) => {
    posts++;
    await route.fetch();
    await route.abort();
  });
  await input.fill("已经受理并恢复的对白");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) => k.startsWith("pending:"))
            .length,
      ),
    )
    .toBe(0);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("");
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "完整记录", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "完整历史记录" })
      .getByText("已经受理并恢复的对白", { exact: true }),
  ).toHaveCount(1);
});
