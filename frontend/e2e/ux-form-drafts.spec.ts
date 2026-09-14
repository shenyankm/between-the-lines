import { test, expect } from "@playwright/test";
import { start, state, closePanel } from "./v3-helpers";

test("unsubmitted HR input survives panel closure, refresh, and server validation failure", async ({
  page,
}, info) => {
  await start(page);
  const open = async () => {
    await page.getByRole("button", { name: /^工作系统/ }).click();
    await page.getByRole("button", { name: "人事申请", exact: true }).click();
  };
  await open();
  await page
    .getByRole("textbox", { name: "申请理由", exact: true })
    .fill("希望调整工作安排");
  await page
    .getByRole("textbox", { name: "原因", exact: true })
    .fill("需要休息一天");
  await page
    .getByRole("textbox", { name: "交接或分工安排", exact: true })
    .fill("先交接实验记录");
  await page.getByLabel("申请事项").selectOption("help");
  await expect(
    page.getByRole("textbox", { name: "原因", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("textbox", { name: "原因", exact: true })
    .fill("需要协作支持");
  await page.getByLabel("申请事项").selectOption("leave");
  await expect(
    page.getByRole("textbox", { name: "原因", exact: true }),
  ).toHaveValue("需要休息一天");
  await closePanel(page);
  await open();
  await expect(
    page.getByRole("textbox", { name: "申请理由", exact: true }),
  ).toHaveValue("希望调整工作安排");
  await page.reload();
  await open();
  await expect(
    page.getByRole("textbox", { name: "原因", exact: true }),
  ).toHaveValue("需要休息一天");
  await expect(
    page.getByRole("textbox", { name: "交接或分工安排", exact: true }),
  ).toHaveValue("先交接实验记录");
  const p = await state(page);
  expect("exit_draft" in p.save.state && p.save.state.exit_draft).toBeNull();
  await page.route("**/api/saves/*/turns", async (route) => {
    const body = route.request().postDataJSON();
    await route.continue({
      postData: JSON.stringify({
        ...body,
        params: { ...body.params, reason: "" },
      }),
    });
  });
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.status() === 422,
  );
  await page
    .getByRole("button", { name: "保存并预览申请", exact: true })
    .click();
  await response;
  await expect(
    page.getByRole("textbox", { name: "原因", exact: true }),
  ).toHaveValue("需要休息一天");
  await page.screenshot({
    path: `../artifacts/issue-33-${info.project.name}.png`,
    fullPage: true,
  });
  await page.unroute("**/api/saves/*/turns");
  await page.getByRole("button", { name: "清空本类申请输入" }).click();
  await expect(
    page.getByRole("textbox", { name: "原因", exact: true }),
  ).toHaveValue("");
});
