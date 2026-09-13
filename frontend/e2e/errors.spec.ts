import { start, readScene } from "./v3-helpers";
import { test, expect } from "@playwright/test";

const envelope = (
  code: string,
  message: string,
  recovery: string,
  wait?: number,
) => ({
  error: {
    code,
    message,
    recovery,
    request_id: "browser-trace",
    ...(wait === undefined ? {} : { retry_after_seconds: wait }),
  },
});

test("service failure is recoverable without pretending the user logged out", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 500,
      json: envelope("internal_error", "身份服务暂不可用。", "retry"),
    }),
  );
  await page.goto("/");
  await expect(page.getByText("身份服务暂不可用。")).toBeVisible();
  await expect(page.getByRole("link", { name: "返回首页登录" })).toHaveCount(0);
  await page.unroute("**/api/auth/me");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByText("身份服务暂不可用。")).toHaveCount(0);
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await expect(
    page.getByRole("button", { name: "开始新的故事" }),
  ).toBeVisible();
});

test("quota wait preserves input and prevents another submission until expiry", async ({
  page,
}) => {
  await start(page);
  let posts = 0;
  await page.route("**/api/saves/*/turns", (route) => {
    posts++;
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "2" },
      json: envelope("concurrency_budget_exhausted", "当前较忙。", "wait", 2),
    });
  });
  const input = page.getByRole("textbox", { name: "自由表达" });
  await input.fill("限流后保留的输入");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("当前较忙。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await expect(input).toHaveValue("限流后保留的输入");
  await page.getByText("错误详情").click();
  await expect(
    page.getByText(/错误码：concurrency_budget_exhausted/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
  expect(posts).toBe(1);
  await page.unroute("**/api/saves/*/turns");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(input).toHaveValue("");
});

test("session expiry pauses an accepted turn and only resumes for the same user", async ({
  page,
}) => {
  await start(page);
  let posts = 0;
  await page.route("**/api/saves/*/turns", async (route) => {
    posts++;
    await route.fetch();
    await route.abort();
  });
  await page.route("**/api/saves/*/turns/*", (route) =>
    route.fulfill({
      status: 401,
      json: envelope("not_authenticated", "登录已失效。", "login"),
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      json: envelope("not_authenticated", "登录已失效。", "login"),
    }),
  );
  await page
    .getByRole("textbox", { name: "自由表达" })
    .fill("身份失效前已提交");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("link", { name: "返回首页登录" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((key) => key.startsWith("pending:v1:")),
    ),
  ).toBe(true);
  await page.unroute("**/api/auth/me");
  await page.unroute("**/api/saves/*/turns/*");
  await page.reload();
  await readScene(page);
  await expect(page.getByRole("textbox", { name: "自由表达" })).toBeEnabled();
  expect(posts).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).some((key) =>
          key.startsWith("pending:v1:"),
        ),
      ),
    )
    .toBe(false);
});

test("failed terminal replies require explicit continuation and logout errors stay local", async ({
  page,
}) => {
  await start(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let posts = 0;
  await page.route("**/api/saves/*/turns", async (route) => {
    posts++;
    // Commit a real mock turn, then exercise the UI's failed-result branch.
    const response = await route.fetch();
    const wire = await response.text();
    const final = wire
      .split("\n\n")
      .find((frame) => frame.startsWith("event: done"));
    if (!final) throw new Error("Missing committed result");
    const result = JSON.parse(
      final.slice("event: done\ndata: ".length),
    ) as Record<string, unknown>;
    result.status = "failed";
    result.failure = {
      code: "turn_timeout",
      message: "回复超时。已保存的行动仍然有效，请刷新进度后继续。",
      request_id: "browser-trace",
      recovery: "refresh",
    };
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `event: done\ndata: ${JSON.stringify(result)}\n\n`,
    });
  });
  const input = page.getByRole("textbox", { name: "自由表达" });
  await input.fill("失败后的保留输入");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("回复超时。已保存的行动仍然有效，请刷新进度后继续。"),
  ).toBeVisible();
  await expect(input).toHaveValue("失败后的保留输入");
  expect(posts).toBe(1);
  await page.unroute("**/api/saves/*/turns");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(input).toHaveValue("");
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({
      status: 500,
      json: envelope("internal_error", "退出暂未完成。", "retry"),
    }),
  );
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByText("退出暂未完成。")).toBeVisible();
  await expect(input).toBeVisible();
  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "重试退出" }).click();
  await expect(
    page.getByRole("button", { name: "开发环境试玩" }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
