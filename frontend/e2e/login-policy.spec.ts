import { expect, test } from "@playwright/test";

// Browser UI fixtures only. Production endpoint enforcement and real DB binding
// are tested by pytest; no OAuth provider is contacted by these browser tests.
const config = {
  guest_login: false,
  dev_login: false,
  zhihu_login: true,
  agent_mode: "deepseek",
  model_ready: true,
  story_version: 3,
};

test("public home offers only Zhihu authorization", async ({ page }, info) => {
  await page.route("**/api/config", (route) => route.fulfill({ json: config }));
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "not_authenticated",
          message: "请先登录。",
          recovery: "login",
        },
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "知乎授权登录" }),
  ).toHaveAttribute("href", "/api/auth/zhihu");
  await expect(page.getByText("立即试玩 · 第一幕")).toHaveCount(0);
  await expect(page.getByText("开发环境试玩")).toHaveCount(0);
  await expect(page.getByText("开始新的故事")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("zhihu-only-home.jpg"),
    fullPage: true,
    quality: 80,
  });
});

for (const path of ["/", "/saves", "/play/old-save"]) {
  test(`existing guest must authorize before gameplay at ${path}`, async ({
    page,
  }, info) => {
    let member = false;
    const gameRequests: string[] = [];
    await page.route("**/api/config", (route) =>
      route.fulfill({ json: config }),
    );
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        json: {
          id: member ? "member" : "guest",
          name: "试玩者",
          identity_type: member ? "member" : "guest",
          can_play: member,
          guest_expires_at: "2026-09-20T00:00:00Z",
          binding_pending: false,
        },
      }),
    );
    await page.route("**/api/saves**", (route) => {
      if (!member) gameRequests.push(route.request().url());
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/auth/zhihu", (route) => {
      member = true;
      return route.fulfill({ status: 303, headers: { location: "/" } });
    });
    await page.goto(path);
    await expect(
      page.getByRole("region", { name: "登录后继续" }),
    ).toBeVisible();
    await expect(page.getByText(/在试玩有效期内登录可继承进度/)).toBeVisible();
    const login = page.getByRole("link", { name: "知乎授权登录" });
    await expect(login).toHaveAttribute("href", "/api/auth/zhihu");
    expect(gameRequests).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (path === "/")
      await page.screenshot({
        path: info.outputPath("existing-guest-login.jpg"),
        fullPage: true,
        quality: 80,
      });
    await login.click();
    await expect(
      page.getByRole("button", { name: "开始新的故事" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "登录后继续" })).toHaveCount(
      0,
    );
  });
}
