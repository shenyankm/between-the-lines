import { test, expect } from "@playwright/test";
import {
  start,
  state,
  perform,
  supplement,
  dialogue,
  readScene,
} from "./v3-helpers";
for (const branch of ["cut_ties", "keep_distance"] as const) {
  test(`complete v3 ${branch} with actual work, confirmed choices and saved history`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await start(page);
    await perform(page, "boundary");
    await perform(page, "next");
    await supplement(page);
    await perform(page, "report");
    await perform(page, "support_project");
    await perform(page, "approve_purchase");
    expect((await state(page)).save.state.procurement).toBe("approved");
    await page.reload();
    await readScene(page);
    await perform(page, "next");
    await perform(page, "deliver");
    await perform(page, "clarify");
    await perform(page, "review_clarification");
    await perform(page, branch);
    await perform(page, "project_review");
    if (branch === "cut_ties") await perform(page, "follow_up");
    await perform(page, "close_story");
    const p = await state(page);
    expect(p.save.state.ending).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: p.save.state.ending!, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "结局正文" }),
    ).not.toContainText("正在根据本局经历");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: p.save.state.ending!, exact: true }),
    ).toBeVisible();
    expect((await state(page)).save.state).toEqual(p.save.state);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../artifacts/${info.project.name}-v3-${branch}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
test("refresh recovers an accepted reply without repeating the request", async ({
  page,
}) => {
  await start(page);
  let posts = 0;
  let accepted!: () => void;
  const ready = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route("**/api/saves/*/turns", async (route) => {
    posts++;
    await route.fetch();
    accepted();
    await route.abort();
  });
  await dialogue(page).fill("刷新恢复验证");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await ready;
  await page.reload();
  await readScene(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) => k.startsWith("pending:"))
            .length,
      ),
    )
    .toBe(0);
  await page.getByRole("button", { name: "完整记录" }).click();
  await expect(
    page
      .getByRole("region", { name: "完整历史记录" })
      .getByText("刷新恢复验证", { exact: true }),
  ).toHaveCount(1);
  expect(posts).toBe(1);
});
