import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { start, state } from "./v3-helpers";

const endings: [string, string, string][] = [
  ["rules_rewritten", "改写规则", "E01"],
  ["professional_boundary", "各自为界", "E02"],
  ["limited_repair", "有限修复", "E03"],
  ["active_exit", "主动转身", "E04"],
  ["career_cost", "付出代价", "E05"],
  ["unresolved", "尚未破局", "E06"],
];

test("six original ending cards load completely without generated text", async ({
  page,
}, info) => {
  await start(page);
  const original = await state(page);
  const artifact = `../artifacts/ending-posters/${info.project.name}`;
  await mkdir(artifact, { recursive: true });
  let index = 0;
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/assets/ending-")) requests.push(request.url());
  });
  await page.route("**/play-state", (route) =>
    route.fulfill({
      json: {
        ...original,
        save: {
          ...original.save,
          state: {
            ...original.save.state,
            act: 4,
            node: "ending",
            ending: endings[index]![1],
            outcome: {
              id: endings[index]![0],
              title: endings[index]![1],
              achievements: [
                "已参加欢送会",
                "同意后续邀请",
                "原材料合格，经复核通过",
              ],
              unresolved: ["项目职责转交尚未纠正"],
              key_event_ids: [],
            },
          },
        },
      },
    }),
  );
  await page.route("**/jobs", (route) =>
    route.fulfill({
      json: {
        id: "poster",
        kind: "ending",
        status: "completed",
        result: {
          text: "这些记录保留了本局已经发生的经历，问题仍待处理。\n\n之后如何回应，仍由你决定。",
        },
      },
    }),
  );
  for (index = 0; index < endings.length; index++) {
    const before = requests.length;
    await page.reload();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.getByRole("button", { name: "查看本局结算" }).click();
    const region = page.getByRole("region", { name: "故事结局", exact: true });
    const art = region.getByRole("img");
    await expect(art).toHaveAttribute(
      "alt",
      `${endings[index]![2]} ${endings[index]![1]}：文档原版结局卡片`,
    );
    await expect(art).toBeVisible();
    const bounds = await art.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    expect(bounds!.width / bounds!.height).toBeCloseTo(941 / 1672, 2);
    await expect
      .poll(() => art.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBeGreaterThan(0);
    expect(
      requests
        .slice(before)
        .every((url) =>
          url.includes(
            ["rules", "boundary", "repair", "exit", "cost", "unresolved"][
              index
            ]!,
          ),
        ),
    ).toBe(true);
    await expect(
      region.getByText("这些记录保留了本局已经发生的经历，问题仍待处理。"),
    ).toHaveCount(0);
    await expect(page.getByRole("region", { name: "已保存事实" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "预览分享卡" })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${artifact}/${endings[index]![2]}.jpg`,
      fullPage: true,
    });
  }
});

test("320px ending card gives an honest fallback after art failure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await start(page);
  const original = await state(page);
  await page.route("**/assets/ending-*", (route) => route.abort());
  await page.route("**/play-state", (route) =>
    route.fulfill({
      json: {
        ...original,
        save: {
          ...original.save,
          state: {
            ...original.save.state,
            ending: "尚未破局",
            outcome: {
              id: "unresolved",
              title: "尚未破局",
              achievements: ["已经核实的记录".repeat(80)],
              unresolved: ["仍待确认".repeat(80)],
              key_event_ids: [],
            },
          },
        },
      },
    }),
  );
  await page.route("**/jobs", (route) =>
    route.fulfill({
      json: { id: "failed", kind: "ending", status: "unknown", result: null },
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "查看本局结算" }).click();
  await expect(
    page.getByText("结局卡片暂时未能加载，请刷新重试。"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
