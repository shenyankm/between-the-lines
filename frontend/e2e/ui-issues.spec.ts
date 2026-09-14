import { expect, test } from "@playwright/test";
import { dialogue, start, state } from "./v3-helpers";

test("leaving preserves identity, saved facts and the unsent draft; logout is separate", async ({
  page,
}) => {
  await start(page);
  const url = page.url();
  const before = await state(page);
  const logoutRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/logout"))
      logoutRequests.push(request.url());
  });
  await dialogue(page).fill("这段话留到下次再说。");
  await page.getByRole("button", { name: "返回存档", exact: true }).click();
  await expect(page).toHaveURL(/\/saves$/);
  expect(logoutRequests).toEqual([]);
  await page.getByRole("link", { name: "打开故事" }).click();
  await expect(page).toHaveURL(url);
  await expect(dialogue(page)).toHaveValue("这段话留到下次再说。");
  const after = await state(page);
  expect(after.save.version).toBe(before.save.version);
  expect(after.save.state).toEqual(before.save.state);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(logoutRequests).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "开发环境试玩" }),
  ).toBeVisible();
});

test("all five drawers scroll, close with Escape and restore focus without overflow", async ({
  page,
}, testInfo) => {
  await start(page);
  await page.screenshot({
    path: `../artifacts/ui/${testInfo.project.name}-stage.jpg`,
    fullPage: true,
    quality: 70,
  });
  for (const name of [
    "我的手机",
    "工作系统",
    "关系图",
    "知乎众议",
    "完整记录",
  ]) {
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "关闭面板" }),
    ).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    if (name === "工作系统") {
      await expect
        .poll(async () => {
          const box = await dialog.boundingBox();
          return Math.abs(box!.x + box!.width - page.viewportSize()!.width);
        })
        .toBeLessThan(2);
      await page.screenshot({
        path: `../artifacts/ui/${testInfo.project.name}-work.jpg`,
        quality: 70,
      });
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("one through six saves and long endings fit without horizontal overflow", async ({
  page,
}, testInfo) => {
  await start(page);
  const original = (await state(page)).save;
  let count = 1;
  await page.route("**/api/saves", async (route) => {
    await route.fulfill({
      json: Array.from({ length: count }, (_, index) => ({
        ...original,
        id: `layout-${index}`,
        state: {
          ...original.state,
          ending:
            index === 0
              ? "很长的结局名称用于验证卡片在窄屏上的自动换行".repeat(4)
              : null,
        },
        parent_save_id: index % 2 ? original.id : null,
      })),
    });
  });
  for (count = 1; count <= 6; count++) {
    await page.goto("/saves");
    await expect(page.getByRole("link", { name: "打开故事" })).toHaveCount(
      count,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const link of await page
      .getByRole("link", { name: "打开故事" })
      .all()) {
      await expect(link).toBeVisible();
    }
  }
  await page.screenshot({
    path: `../artifacts/ui/${testInfo.project.name}-saves.jpg`,
    fullPage: true,
    quality: 70,
  });
});

test("long ending paragraphs and factual lists remain readable", async ({
  page,
}, info) => {
  await start(page);
  const play = await state(page);
  const text = "她回看已经留下的记录，决定为下一步保留空间。".repeat(40);
  await page.route("**/play-state", (route) =>
    route.fulfill({
      json: {
        ...play,
        save: {
          ...play.save,
          state: {
            ...play.save.state,
            ending: "cut_ties",
            outcome: {
              title: "选择自己的方向",
              achievements: ["已经完成的工作".repeat(20)],
              unresolved: ["仍需要继续处理的事项".repeat(20)],
            },
          },
        },
      },
    }),
  );
  await page.route("**/jobs", (route) =>
    route.fulfill({
      json: {
        id: "layout-ending",
        kind: "ending",
        status: "completed",
        result: { text: `${text}\n\n第二段保留独立段落。` },
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("第二段保留独立段落。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "已保存事实", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `../artifacts/ui/${info.project.name}-ending.jpg`,
    fullPage: true,
    quality: 70,
  });
});
