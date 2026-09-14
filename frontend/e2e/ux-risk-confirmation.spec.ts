import { test, expect } from "@playwright/test";
import {
  start,
  perform,
  state,
  commitClick,
  closePanel,
  readScene,
} from "./v3-helpers";

test("review warns before loss; cancellation preserves facts; extension avoids the warning", async ({
  page,
}, info) => {
  await start(page);
  await perform(page, "next");
  await perform(page, "next");
  const before = (await state(page)).save.state;
  // Project controls were removed from the work panel; exercise the same
  // persisted proposal through the API and its restored confirmation UI.
  const current = await state(page);
  const proposed = await page.request.post(
    `/api/saves/${current.save.id}/turns`,
    {
      data: {
        request_id: crypto.randomUUID(),
        version: current.save.version,
        action: "propose",
        proposed_action: "project_review",
        npc: "zhang",
        text: "",
      },
    },
  );
  expect(proposed.ok()).toBe(true);
  await expect.poll(async () => (await state(page)).active_turn).toBeNull();
  await page.reload();
  await expect(page.getByRole("alertdialog")).toContainText("现在复核将转交");
  await page.screenshot({
    path: `../artifacts/issue-27-${info.project.name}.png`,
    fullPage: true,
  });
  await commitClick(page, () =>
    page.getByRole("button", { name: "暂不执行", exact: true }).click(),
  );
  expect((await state(page)).save.state).toEqual(before);
  await perform(page, "request_extension");
  await perform(page, "project_review");
  const after = (await state(page)).save.state;
  expect("work" in after && after.work?.facts?.career_loss).toBeFalsy();
  await closePanel(page);
  await readScene(page);
  await commitClick(page, () =>
    page
      .getByRole("button", { name: "按当前进度结束本局", exact: true })
      .click(),
  );
  await expect(
    page.getByRole("region", { name: "本局收束预览" }),
  ).toContainText("已发生，尚未解决");
  await expect(
    page.getByRole("region", { name: "本局收束预览" }),
  ).toContainText("尚未发生");
});
