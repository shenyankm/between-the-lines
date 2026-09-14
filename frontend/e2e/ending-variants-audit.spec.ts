import { test, expect } from "@playwright/test";
import {
  start,
  state,
  perform,
  commitClick,
  closePanel,
  readScene,
} from "./v3-helpers";

for (const kind of ["transfer", "withdraw"] as const) {
  test(`exit variant ${kind}`, async ({ page }) => {
    await start(page);
    await page.getByRole("button", { name: /^工作系统/ }).click();
    await page.getByRole("button", { name: "人事申请" }).click();
    await page
      .getByRole("combobox", { name: "申请类型", exact: true })
      .selectOption(kind);
    await page
      .getByLabel("申请理由", { exact: true })
      .fill("希望重新安排职业生活");
    await commitClick(page, () =>
      page.getByRole("button", { name: "保存并预览", exact: true }).click(),
    );
    expect((await state(page)).save.state.ending).toBeNull();
    await commitClick(page, () =>
      page
        .getByRole("button", { name: "确认提交退出申请", exact: true })
        .click(),
    );
    await commitClick(page, () =>
      page.getByRole("button", { name: "确认并提交" }).click(),
    );
    await readScene(page);
    await expect(
      page.getByRole("img", { name: /主动转身：文档原版/ }),
    ).toBeVisible();
    await page.reload();
    const s = (await state(page)).save.state;
    expect("exit_draft" in s && s.exit_draft).toMatchObject({
      kind,
      submitted: true,
    });
  });
}
for (const label of [
  "我愿意参加，请分别发安排和工作资料。",
  "先告诉我安排，我再决定。",
] as const) {
  test(`later cooperation ${label}`, async ({ page }) => {
    await start(page);
    for (const action of [
      "next",
      "dispute_return",
      "approve_purchase",
      "next",
      "deliver",
      "clarify",
      "review_clarification",
      "cut_ties",
      "project_review",
    ] as const)
      await perform(page, action);
    await commitClick(page, () =>
      page.getByRole("button", { name: label, exact: true }).click(),
    );
    await readScene(page);
    await perform(page, "close_story");
    await expect(
      page.getByRole("img", { name: /各自为界：文档原版/ }),
    ).toBeVisible();
  });
}
test("actual rule changes outrank repaired friendship without erasing it", async ({
  page,
}) => {
  await start(page);
  for (const action of [
    "next",
    "dispute_return",
    "approve_purchase",
    "next",
    "deliver",
    "clarify",
    "review_clarification",
    "confirm_responsibility",
    "change_rules",
    "project_review",
    "apply_rules",
    "repair_friendship",
    "acknowledge_harm",
    "complete_remedy",
    "follow_up",
    "close_story",
  ] as const)
    await perform(page, action);
  await closePanel(page);
  await expect(
    page.getByRole("img", { name: /改写规则：文档原版/ }),
  ).toBeVisible();
  const s = (await state(page)).save.state;
  expect("relationship" in s && s.relationship?.facts?.remedy).toBeTruthy();
});
