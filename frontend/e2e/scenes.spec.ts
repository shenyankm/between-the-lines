import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/saves", async (route) => {
    if (route.request().method() === "POST")
      await route.continue({
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          story_version: 1,
        }),
      });
    else await route.continue();
  });
});
import { readFileSync } from "node:fs";

/** Parsed-JSON shape; structurally matches Playwright's serializable `json`. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const story = JSON.parse(
  readFileSync(new URL("../src/testing/story.json", import.meta.url), "utf8"),
) as Json;

test("all six locations render, interludes cancel safely and advance once", async ({
  page,
}, info) => {
  let act = 0;
  let turns = 0;
  const save = () => ({
    id: "scene-preview",
    version: act,
    state: {
      act,
      credit: 50,
      stress: 25,
      heat: 10,
      flags: act >= 3 ? ["clarified", "delivered", "sun_cut"] : ["boundary"],
      procurement: act >= 2 ? "approved" : "pending",
      ending: act === 4 ? "保持职业关系和边界" : null,
    },
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/visit") || path.endsWith("/diagnostics")) {
      await route.fulfill({ json: save() });
      return;
    }
    if (route.request().method() === "POST") {
      turns++;
      act++;
      await route.fulfill({
        contentType: "text/event-stream",
        body: `event: done\ndata: ${JSON.stringify({ turn_id: `turn-${turns}`, status: "completed", save: save(), text: "", retryable: false })}\n\n`,
      });
    } else {
      await route.fulfill({
        json: path.endsWith("/auth/me")
          ? { id: "scene-user", name: "preview" }
          : path.endsWith("/play-state")
            ? { save: save(), events: [], active_turn: null }
            : path.endsWith("/story")
              ? story
              : path.endsWith("/events") || path === "/api/saves"
                ? []
                : save(),
      });
    }
  });
  await page.goto("/play/scene-preview");
  const stage = page.locator('section[style*="--scene-background"]');
  for (const [index, image] of [
    "office-morning",
    "cafeteria-noon",
    "finance-rain",
    "meeting-morning",
    "office",
  ].entries()) {
    await expect(stage).toHaveCSS(
      "background-image",
      new RegExp(`${image}-[0-9]+-[a-f0-9]+\\.webp`),
    );
    // Verify the asset itself decodes, not only the CSS URL.
    expect(
      await page.evaluate(async (src) => {
        const img = new Image();
        img.src = `/assets/${src}.png`;
        await img.decode();
        return img.naturalWidth;
      }, image),
    ).toBeGreaterThan(0);
    if (index === 4) break;
    await page
      .getByRole("button", {
        name: index === 0 ? "进入故事" : "继续故事",
        exact: true,
      })
      .click();
    if (index === 1 || index === 2) {
      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await expect(modal.getByRole("heading")).toContainText(
        index === 1 ? "卧室" : "走廊",
      );
      expect(
        await modal.locator("img").evaluate(async (el: HTMLImageElement) => {
          await el.decode();
          return el.naturalWidth;
        }),
      ).toBeGreaterThan(0);
      await page.screenshot({
        path: `../artifacts/${info.project.name}-scene-${index}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      expect(turns).toBe(index);
      await page.getByRole("button", { name: "继续故事", exact: true }).click();
      await page.getByRole("button", { name: "进入下一幕" }).click();
    }
  }
  expect(turns).toBe(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
