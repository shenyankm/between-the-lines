import { test, expect } from "@playwright/test";
import { start, say, state } from "./v3-helpers";
test("completed scene dialogue must replace the opening line on stage", async ({
  page,
}, info) => {
  await start(page);
  await say(page, "我想知道你刚刚那句话是什么意思？");
  const s = await state(page);
  const reply = s.events
    .filter((e) => e.kind === "npc" && e.channel === "scene")
    .at(-1);
  expect(reply).toBeTruthy();
  await info.attach("saved-reply", {
    body: JSON.stringify({
      node: "node" in s.save.state ? s.save.state.node : null,
      reply,
    }),
    contentType: "application/json",
  });
  await expect(page.getByText(reply!.text, { exact: true })).toBeVisible({
    timeout: 5000,
  });
  await page.reload();
  await expect(page.getByText(reply!.text, { exact: true })).toBeVisible();
});
