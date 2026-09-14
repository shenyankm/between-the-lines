import { expect, test } from "@playwright/test";
import { dialogue, start, state } from "./v3-helpers";

test("returning preserves progress and draft, while logout ends the session", async ({
  page,
}, info) => {
  await start(page);
  const storyUrl = page.url();
  const initial = await state(page);
  let logouts = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/logout")) logouts++;
  });
  await dialogue(page).fill("等我回来再继续讨论。");
  await page.screenshot({
    path: `../artifacts/story-return/${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "返回存档", exact: true }).click();
  await expect(page).toHaveURL(/\/saves$/);
  expect(logouts).toBe(0);
  await page.locator(`a[href="${new URL(storyUrl).pathname}"]`).click();
  await expect(dialogue(page)).toHaveValue("等我回来再继续讨论。");
  const resumed = await state(page);
  expect(resumed.save.version).toBe(initial.save.version);
  expect(resumed.save.state).toEqual(initial.save.state);
  expect(resumed.reading).toEqual(initial.reading);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(logouts).toBe(1);
});

test("return stays disabled while a submitted turn has no result", async ({
  page,
}) => {
  await start(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/turns", async (route) => {
    await gate;
    await route.continue();
  });
  const originalUrl = page.url();
  await dialogue(page).fill("请说明当前工作安排。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const leave = page.getByRole("button", { name: "返回存档", exact: true });
  await expect(leave).toBeDisabled();
  expect(page.url()).toBe(originalUrl);
  release();
  await expect(leave).toBeEnabled();
  await expect(dialogue(page)).toHaveValue("");
});
