import { test, expect } from "@playwright/test";
import { start, perform } from "./v3-helpers";

test("relationship responses are attributed to Sun and leave the player's next choice open", async ({
  page,
}, info) => {
  await start(page);
  await perform(page, "next");
  await perform(page, "next");
  await perform(page, "repair_friendship");
  await perform(page, "acknowledge_harm");
  await page.getByRole("button", { name: "关系图", exact: true }).click();
  const scene = page.getByRole("region", { name: "关系回应场景" });
  await expect(scene).toContainText("孙淼 · 回应与承认伤害");
  await expect(scene).toContainText("孙淼：我也愿意");
  await expect(scene).toContainText("是否恢复友谊仍由你决定");
  await expect(
    page.getByRole("button", { name: "仅保留职业关系", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `../artifacts/issue-32-${info.project.name}.png`,
    fullPage: true,
  });
  await perform(page, "cut_ties");
});
