import { test, expect } from "@playwright/test";
import { start, dialogue, commitClick } from "./v3-helpers";

test("narrow layouts keep tools and input reachable without horizontal overflow", async ({
  page,
}, info) => {
  await start(page);
  await page.screenshot({
    path: `../artifacts/issue-34-${info.project.name}.png`,
    fullPage: true,
  });
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await dialogue(page).fill(
      "我希望先核对工作材料，再讨论下一步。".repeat(12),
    );
    await dialogue(page).focus();
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    for (const name of ["我的手机", "关系图", "返回首页"]) {
      const control = page.getByRole("button", { name, exact: true });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    if (width! <= 700) {
      const before = await dialogue(page).evaluate((input) => {
        const tools = document.querySelector('button[data-panel="phone"]');
        return (
          !!tools &&
          !!(
            input.compareDocumentPosition(tools) &
            Node.DOCUMENT_POSITION_FOLLOWING
          )
        );
      });
      expect(before).toBe(true);
    }
    await dialogue(page).focus();
    await commitClick(page, () =>
      page.getByRole("button", { name: "发送", exact: true }).click(),
    );
    await expect(dialogue(page)).toHaveValue("");
  }
});
