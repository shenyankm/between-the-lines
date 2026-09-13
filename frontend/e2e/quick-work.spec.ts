import { test, expect } from "@playwright/test";

test("quick work requests select the right NPC, commit immediately and survive refresh", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.getByRole("button", { name: "进入故事" }).click();
  const input = page.getByRole("textbox", { name: "对角色说的话" });
  async function choose(name: string) {
    const b = page.getByRole("button", { name, exact: true });
    await expect(b).toBeEnabled();
    await b.click();
    await expect(input).toBeEnabled();
  }
  await expect(input).toBeEnabled();
  await choose("明确表达我的边界");
  await choose("继续故事");
  await choose("进入下一幕");
  for (const [label, npc] of [
    ["询问采购材料", "li"],
    ["请李姐审核", "li"],
    ["请张工落实支持", "zhang"],
  ] as const) {
    if (label === "请李姐审核") await choose("补齐采购材料");
    if (label === "请张工落实支持") await choose("向张工同步进度");
    const request = page.waitForResponse(
      (r) => r.url().endsWith("/turns") && r.request().method() === "POST",
    );
    await choose(label);
    const response = await request;
    const body = response.request().postDataJSON() as {
      npc: string;
      request_id: string;
      action: string;
    };
    expect(body.npc).toBe(npc);
    expect(body.action).toBe("speak");
    const saveId = page.url().split("/").at(-1)!;
    const turn = await page.request.get(
      `/api/saves/${saveId}/turns/${body.request_id}`,
    );
    const data = (await turn.json()) as {
      usage: { model_calls: number };
      status: string;
    };
    expect(data.status).toBe("completed");
    expect(data.usage.model_calls).toBe(0);
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "请李姐审核" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "请张工落实支持" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "继续故事", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("quick-work.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
