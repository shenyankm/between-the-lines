import { expect, test } from "@playwright/test";
import { responsiveFixture } from "./responsive-fixtures";

test("refresh restores the phone list and conversation until explicitly closed", async ({
  page,
}) => {
  const fixture = await responsiveFixture(page);
  await fixture.stage();
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "我的手机", exact: true }).click();
  await page.reload();
  await expect(dialog.getByRole("heading", { name: "通讯" })).toBeVisible();
  await dialog.getByRole("button", { name: "孙淼", exact: true }).click();
  await page.reload();
  await expect(dialog.getByRole("heading", { name: "孙淼" })).toBeVisible();
  await expect(dialog.getByLabel("自由表达")).toBeVisible();
  await dialog.getByRole("button", { name: "返回会话列表" }).click();
  await dialog.getByRole("button", { name: "关闭面板" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "我的手机", exact: true }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("refresh restores the anchored discussion panel", async ({ page }) => {
  const fixture = await responsiveFixture(page);
  await fixture.stage();
  await page.getByRole("button", { name: "知乎众议", exact: true }).click();
  await page.reload();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "知乎众议" })).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(false);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "知乎众议", exact: true }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
});
