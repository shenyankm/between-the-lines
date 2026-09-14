import { restoreHistoryPanel } from "./v3-helpers";
import { start, readScene, exitStory, commitClick } from "./v3-helpers";
import { test, expect, type Page } from "@playwright/test";
import type { TurnInput } from "../src/types";

const input = (page: Page) => page.getByRole("textbox", { name: "自由表达" });

const failure = {
  error: {
    code: "internal_error",
    message: "流程验收：暂时无法加载。",
    recovery: "retry",
    request_id: "e2e-recovery",
  },
};

for (const endpoint of [
  "/api/config",
  "/api/story",
  "/api/saves/*/play-state",
  "/api/saves",
]) {
  test(`read failure and explicit reload recover ${endpoint}`, async ({
    page,
  }) => {
    await start(page);
    await page.route(
      `**${endpoint}${endpoint === "/api/story" ? "*" : ""}`,
      (route) => route.fulfill({ status: 500, json: failure }),
    );
    if (endpoint === "/api/config") await page.goto("/");
    else if (endpoint === "/api/saves") await page.goto("/saves");
    else await page.reload();
    await expect(page.getByRole("alert")).toContainText(failure.error.message);
    await page.unroute(`**${endpoint}${endpoint === "/api/story" ? "*" : ""}`);
    await page.getByRole("button", { name: "重新加载" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (endpoint === "/api/config")
      await expect(
        page.getByRole("button", { name: "开始新的故事" }),
      ).toBeVisible();
    else if (endpoint === "/api/saves")
      await expect(
        page.getByRole("link", { name: "打开故事", exact: true }),
      ).toBeVisible();
    else {
      await readScene(page);
      await expect(input(page)).toBeEnabled();
    }
  });
}

for (const operation of ["login", "create"]) {
  test(`failed ${operation} does not retry a write automatically and manual retry works`, async ({
    page,
  }) => {
    await page.goto("/");
    if (operation === "create")
      await page.getByRole("button", { name: "开发环境试玩" }).click();
    const path = operation === "login" ? "**/api/auth/dev" : "**/api/saves";
    let writes = 0;
    await page.route(path, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes++;
      return route.fulfill({ status: 500, json: failure });
    });
    const button = page.getByRole("button", {
      name: operation === "login" ? "开发环境试玩" : "开始新的故事",
    });
    await button.click();
    await expect(page.getByRole("alert")).toContainText(failure.error.message);
    await expect(button).toBeEnabled();
    expect(writes).toBe(1);
    await page.unroute(path);
    await button.click();
    if (operation === "create") await readScene(page);
    await expect(
      page.getByRole("button", {
        name:
          operation === "login"
            ? "开始新的故事"
            : "既然知道我可能会生气，为什么不直接问我？",
      }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("network loss before acceptance replays the same request once", async ({
  page,
}) => {
  await start(page);
  const bodies: TurnInput[] = [];
  await page.route("**/api/saves/*/turns", (route) => {
    bodies.push(route.request().postDataJSON() as TurnInput);
    return bodies.length === 1 ? route.abort() : route.continue();
  });
  await input(page).fill("受理前断网恢复");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(input(page)).toBeEnabled();
  await expect.poll(() => bodies.length).toBe(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) => k.startsWith("pending:"))
            .length,
      ),
    )
    .toBe(0);
  expect(bodies[0]).toEqual(bodies[1]);
  await restoreHistoryPanel(page);
  await expect(
    page
      .getByRole("region", { name: "完整历史记录" })
      .getByText("受理前断网恢复", { exact: true }),
  ).toHaveCount(1);
});

test("malformed stream after acceptance recovers the original result without a second POST", async ({
  page,
}) => {
  await start(page);
  let posts = 0;
  await page.route("**/api/saves/*/turns", async (route) => {
    posts++;
    await route.fetch();
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'event: done\ndata: {"invalid":true}\n\n',
    });
  });
  await input(page).fill("损坏流恢复验证");
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
  await expect(input(page)).toBeEnabled();
  expect(posts).toBe(1);
  await restoreHistoryPanel(page);
  await expect(
    page
      .getByRole("region", { name: "完整历史记录" })
      .getByText("损坏流恢复验证", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an unavailable ending narrative retries without changing the ending", async ({
  page,
}) => {
  await start(page);
  await exitStory(page);
  await page.route("**/api/saves/*/jobs", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, json: failure })
      : route.continue(),
  );
  await commitClick(page, () =>
    page.getByRole("button", { name: "确认并提交" }).click(),
  );
  await expect(
    page.getByRole("heading", { name: "主动转身", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("结局正文暂时无法生成，以下事实总结仍然有效。"),
  ).toBeVisible();
  await page.unroute("**/api/saves/*/jobs");
  await page.getByRole("button", { name: "重试读取" }).click();
  await expect(page.getByRole("region", { name: "结局正文" })).toContainText(
    "AI",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "主动转身", exact: true }),
  ).toBeVisible();
});
