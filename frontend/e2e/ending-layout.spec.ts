import { expect, test } from "@playwright/test";
import { start, state } from "./v3-helpers";

test("long endings separate narrative, facts and actions in every generation state", async ({
  page,
}, info) => {
  await start(page);
  const original = await state(page);
  let status = "completed";
  await page.route("**/play-state", (route) =>
    route.fulfill({
      json: {
        ...original,
        save: {
          ...original.save,
          state: {
            ...original.save.state,
            ending: "cut_ties",
            outcome: {
              title: "为自己的选择留下空间",
              achievements: ["已核实并完成的工作记录".repeat(15)],
              unresolved: ["仍需后续跟进的事项".repeat(15)],
            },
          },
        },
      },
    }),
  );
  await page.route("**/jobs", (route) =>
    route.fulfill({
      json: {
        id: "layout",
        kind: "ending",
        status,
        result:
          status === "completed"
            ? {
                text:
                  "这段回顾只描述已经留下的经历。".repeat(45) +
                  "\n\n新的段落保留独立阅读空间。",
                interactions: [
                  {
                    actual_expression: "我想先确认具体安排。",
                    feedback: ["好的，请按记录核查。"],
                  },
                ],
              }
            : null,
      },
    }),
  );
  for (status of ["completed", "running", "failed"]) {
    await page.reload();
    const facts = page.getByRole("region", { name: "已保存事实", exact: true });
    await expect(facts).toBeVisible();
    await expect(
      page.getByRole("link", { name: "重新开始一个独立故事" }),
    ).toBeVisible();
    if (status === "completed") {
      await expect(page.getByText("新的段落保留独立阅读空间。")).toBeVisible();
      await page.screenshot({
        path: `../artifacts/ending-layout/${info.project.name}.jpg`,
        fullPage: true,
        quality: 65,
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
