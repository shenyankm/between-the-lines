import { test, expect } from "@playwright/test";
import { start, state } from "./v3-helpers";

test("lost submission response stays uncertain until original committed result is recovered", async ({
  page,
}, info) => {
  await start(page);
  const before = await state(page);
  let posts = 0;
  let releaseLookup: () => void = () => {};
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  await page.route("**/api/saves/*/turns/*", async (route) => {
    await lookupGate;
    await route.continue();
  });
  await page.route("**/api/saves/*/turns", async (route) => {
    posts++;
    await route.fetch();
    await route.abort();
  });
  await page
    .getByRole("button", {
      name: "既然知道我可能会生气，为什么不直接问我？",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "请求是否受理尚未确认" }),
  ).toBeVisible();
  releaseLookup();
  await expect(
    page.getByRole("status").filter({ hasText: "请求是否受理尚未确认" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "既然知道我可能会生气，为什么不直接问我？",
      exact: true,
    }),
  ).toHaveCount(0);
  const after = await state(page);
  expect(posts).toBe(1);
  expect(after.save.version).toBe(before.save.version + 1);
  expect(
    after.events.filter(
      (event) => event.kind === "player" && event.action === "boundary",
    ),
  ).toHaveLength(1);
  await page.screenshot({
    path: `../artifacts/issue-35-${info.project.name}.png`,
    fullPage: true,
  });
});
