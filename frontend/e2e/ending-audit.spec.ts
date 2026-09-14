import { test, expect } from "@playwright/test";
import {
  start,
  state,
  perform,
  readScene,
  exitStory,
  commitClick,
} from "./v3-helpers";
import type { Action } from "../src/types";
const artifactDir =
  process.env.AUDIT_ARTIFACT_DIR || "../artifacts/ending-audit";

const work: Action[] = [
  "next",
  "dispute_return",
  "approve_purchase",
  "next",
  "clarify",
  "review_clarification",
  "deliver",
];
const repair: Action[] = [
  "repair_friendship",
  "acknowledge_harm",
  "complete_remedy",
  "project_review",
  "follow_up",
];
const rules: Action[] = [
  "confirm_responsibility",
  "change_rules",
  "project_review",
  "apply_rules",
];
const routes: {
  name: string;
  path: Action[];
  ending: string;
  exit?: boolean;
}[] = [
  { name: "rules", path: [...work, ...rules], ending: "改写规则" },
  {
    name: "professional",
    path: [...work, "cut_ties", "project_review", "follow_up"],
    ending: "各自为界",
  },
  { name: "repair", path: [...work, ...repair], ending: "有限修复" },
  { name: "exit", path: [], ending: "主动转身", exit: true },
  {
    name: "cost",
    path: ["next", "next", "project_review"],
    ending: "付出代价",
  },
  { name: "unresolved", path: ["next", "next"], ending: "尚未破局" },
  {
    name: "repair-with-unresolved-work",
    path: ["next", "next", "request_extension", ...repair],
    ending: "有限修复",
  },
  {
    name: "cost-before-repair",
    path: ["next", "next", ...repair],
    ending: "付出代价",
  },
  {
    name: "exit-preserves-success",
    path: [...work, ...rules],
    ending: "主动转身",
    exit: true,
  },
  {
    name: "loss-corrected",
    path: [
      "next",
      "next",
      "project_review",
      "dispute_return",
      "approve_purchase",
      "deliver",
      "correct_loss",
    ],
    ending: "尚未破局",
  },
];
for (const route of routes) {
  test(`ending audit ${route.name}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
    });
    await start(page);
    for (const action of route.path) await perform(page, action);
    if (route.exit) {
      await exitStory(page);
      await commitClick(page, () =>
        page.getByRole("button", { name: "确认并提交" }).click(),
      );
      await readScene(page);
    } else await perform(page, "close_story");
    await expect(
      page.getByRole("img", {
        name: new RegExp(route.ending + "：文档原版结局卡片"),
      }),
    ).toBeVisible();
    const finished = (await state(page)).save;
    if (process.env.BTL_REAL_AI_AUDIT === "1") {
      const jobs = (await (
        await page.request.get(`/api/saves/${finished.id}/jobs`)
      ).json()) as { kind: string; status: string }[];
      expect(jobs.find((job) => job.kind === "ending")?.status).toBe(
        "completed",
      );
    }
    await info.attach("save.json", {
      body: JSON.stringify(finished, null, 2),
      contentType: "application/json",
    });
    await page.reload();
    await readScene(page);
    expect((await state(page)).save.state).toEqual(finished.state);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${artifactDir}/${info.project.name}-${route.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
