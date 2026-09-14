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
  await page.getByRole("button", { name: /^工作系统/ }).click();
  await page.getByText("后续工作事项", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "项目复核后果" }),
  ).toContainText("专业信用 -20");
  await commitClick(page, () =>
    page.getByRole("button", { name: "进入项目复核", exact: true }).click(),
  );
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
