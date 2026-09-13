import { test, expect } from "@playwright/test";

test("successful background recovery clears only the submitted draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.getByRole("button", { name: "进入故事" }).click();
  const input = page.getByRole("textbox", { name: "对角色说的话" });
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
  await page.getByRole("button", { name: "回顾", exact: true }).click();
  await expect(
    page.getByText("已经受理并恢复的对白", { exact: true }),
  ).toHaveCount(1);
});
