import { test, expect } from "@playwright/test";
import { start, state, readScene, commitClick, closePanel } from "./v3-helpers";
for (const kind of ["leave", "help"] as const)
  test(`v3 ${kind} application requires submission, review and actual completion`, async ({
    page,
  }) => {
    await start(page);
    await page.getByRole("button", { name: "工作系统", exact: true }).click();
    await page.getByRole("button", { name: "人事申请" }).click();
    await page
      .getByRole("combobox", { name: "申请事项", exact: true })
      .selectOption(kind);
    await page.getByLabel("原因", { exact: true }).fill("需要调整工作负担");
    await page
      .getByLabel("交接或分工安排")
      .fill("文档已整理，请张工安排同事对接");
    await commitClick(page, () =>
      page.getByRole("button", { name: "保存并预览申请", exact: true }).click(),
    );
    await expect(
      page.getByText("草稿，尚未提交", { exact: true }),
    ).toBeVisible();
    await commitClick(page, () =>
      page.getByRole("button", { name: "正式提交申请", exact: true }).click(),
    );
    await expect(
      page.getByText("已提交，等待处理", { exact: true }),
    ).toBeVisible();
    await commitClick(page, () =>
      page
        .getByRole("button", { name: "查看张工的处理意见", exact: true })
        .click(),
    );
    await expect(
      page.getByText("已获批，等待落实", { exact: true }),
    ).toBeVisible();
    await commitClick(page, () =>
      page
        .getByRole("button", {
          name: kind === "leave" ? "按批准安排休息" : "确认分工已经落实",
          exact: true,
        })
        .click(),
    );
    await expect(page.getByText("已落实", { exact: true })).toBeVisible();
    await closePanel(page);
    await page.reload();
    await readScene(page);
    const s = (await state(page)).save.state;
    expect(
      "support_requests" in s && s.support_requests?.[0]?.completion?.event_id,
    ).toBeTruthy();
  });
test("guest completion preserves progress and blocks act two until binding", async ({
  page,
}) => {
  await start(page, true);
  const denied = page.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.status() === 422,
  );
  await page
    .getByRole("button", {
      name: "既然知道我可能会生气，为什么不直接问我？",
      exact: true,
    })
    .click();
  await denied;
  await expect(
    page.getByText("第一幕已完成，绑定知乎后继续；试玩进度会保留。"),
  ).toBeVisible();
  const before = (await state(page)).save;
  expect(before.state.act).toBe(1);
  await page.reload();
  await readScene(page);
  expect((await state(page)).save.state).toEqual(before.state);
});

test("a committed opening choice automatically enters act two using the new save version", async ({
  page,
}) => {
  await start(page);
  const before = (await state(page)).save;
  await page
    .getByRole("button", {
      name: "既然知道我可能会生气，为什么不直接问我？",
      exact: true,
    })
    .click();
  await expect.poll(async () => (await state(page)).save.state.act).toBe(2);
  const after = (await state(page)).save;
  expect(after.version).toBeGreaterThan(before.version);
  expect(after.state.flags).toContain("boundary:act_1");
  await expect(
    page.getByRole("button", { name: "带着当前进度进入下一幕 →" }),
  ).toHaveCount(0);
});
