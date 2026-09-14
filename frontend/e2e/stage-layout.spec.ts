import { expect, test } from "@playwright/test";
import { dialogue, start } from "./v3-helpers";

test("the reading hint stays pinned to the dialogue panel's bottom-right corner", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.waitForURL(/\/play\//);
  // Force the typewriter so the pinning is checked while the line reveals.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const script = page
    .getByRole("button")
    .filter({ hasText: /点击继续|点击显示全文/ });
  await expect(script).toBeVisible();
  const line = () =>
    script.evaluate((button) => button.querySelector("span")!.textContent);
  const corner = () =>
    script.evaluate((button) => {
      const panel = button.closest("section");
      const small = button.querySelector("small")!;
      // Advancing remounts the button; measuring a detached node would lie.
      if (!panel || !panel.isConnected)
        throw new Error("button left its panel");
      const panelRect = panel.getBoundingClientRect();
      const hintRect = small.getBoundingClientRect();
      return {
        hint: small.textContent,
        right: Math.round(panelRect.right - hintRect.right),
        bottom: Math.round(panelRect.bottom - hintRect.bottom),
        panelHeight: Math.round(panelRect.height),
      };
    });
  await page.evaluate(() => document.fonts.ready);
  const samples = [];
  for (let sample = 0; sample < 12; sample++) {
    samples.push(await corner());
    if (samples.at(-1)!.hint === "点击继续 →") break;
    await page.waitForTimeout(500);
  }
  // A long opening line reveals over seconds; the panel and the hint must not
  // move while the text types in.
  expect(samples.length).toBeGreaterThan(1);
  const geometry = samples.map(({ right, bottom, panelHeight }) => ({
    right,
    bottom,
    panelHeight,
  }));
  expect(new Set(geometry.map((row) => JSON.stringify(row))).size).toBe(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const long = await corner();
  const first = await line();
  await script.click();
  await expect.poll(line).not.toBe(first);
  const short = await corner();
  // A short line must not drag the hint away from the corner the long line used.
  expect(Math.abs(long.right - short.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(long.bottom - short.bottom)).toBeLessThanOrEqual(1);
  expect(short.right).toBeLessThanOrEqual(64);
  expect(short.bottom).toBeLessThanOrEqual(40);
});

test("stage controls and grouped metrics fit narrow and wide screens", async ({
  page,
}, info) => {
  await start(page);
  for (const width of info.project.name === "mobile" ? [390] : [900, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(dialogue(page)).toBeVisible();
    await expect(page.getByRole("meter")).toHaveCount(4);
    const next = page.getByRole("button", { name: "带着当前进度进入下一幕 →" });
    await expect(next).toBeVisible();
    const inputBox = await dialogue(page).boundingBox();
    const nextBox = await next.boundingBox();
    expect(nextBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const metric = page.getByRole("meter").first();
    expect(
      await metric.evaluate(
        (el) =>
          getComputedStyle(el.parentElement!.parentElement!).backgroundColor,
      ),
    ).toBe("rgba(16, 32, 51, 0.95)");
    await page.screenshot({
      path: `../artifacts/stage-layout/${width}.jpg`,
      fullPage: true,
      quality: 75,
    });
  }
});

test("portrait artwork keeps its top edge inside the fixed-height band", async ({
  page,
}) => {
  await start(page);
  const portraits = page.locator('[class*="portraits"] img');
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect
      .poll(() =>
        portraits.first().evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    // Any cover overflow must fall to the masked bottom; a nonzero top crop
    // means the anchored top moved and the head is sliced off again.
    const crops = await portraits.evaluateAll((nodes) =>
      nodes.map((node) => {
        const img = node as HTMLImageElement;
        const box = img.getBoundingClientRect();
        const scale = Math.max(
          box.width / img.naturalWidth,
          box.height / img.naturalHeight,
        );
        const overflow = Math.max(0, img.naturalHeight * scale - box.height);
        // Chromium serializes computed object-position as two percentages.
        const ratio =
          parseFloat(
            getComputedStyle(img).objectPosition.split(" ")[1] ?? "0",
          ) / 100;
        return Math.round(overflow * ratio);
      }),
    );
    expect(Math.max(...crops), `top crop at ${width}x${height}`).toBe(0);
  }
});

test("speaker names anchor to the speaker's side of the dialogue panel", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "开发环境试玩" }).click();
  await page.getByRole("button", { name: "开始新的故事" }).click();
  await page.waitForURL(/\/play\//);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const script = page
    .getByRole("button")
    .filter({ hasText: /点击继续|点击显示全文/ });
  const anchor = () =>
    script.evaluate((button) => {
      const panel = button.closest("section");
      // Advancing remounts the button; measuring a detached node would lie.
      if (!panel || !panel.isConnected)
        throw new Error("button left its panel");
      const strong = button.querySelector("strong");
      if (!strong) throw new Error("speaker name missing");
      const box = strong.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      return {
        names: button.querySelectorAll("strong").length,
        text: strong.textContent,
        side: strong.dataset.side,
        leftGap: Math.round(box.left - panelBox.left),
        rightGap: Math.round(panelBox.right - box.right),
      };
    });
  const nameText = () =>
    script.evaluate((button) => button.querySelector("strong")?.textContent);
  const advance = async () => {
    const before = await nameText();
    // Clicking while a line still reveals would not advance the scene.
    await expect(script).toContainText("点击继续 →");
    await script.click();
    // The remount detaches the old button; wait for the new name before measuring.
    await expect.poll(nameText).not.toBe(before);
    return anchor();
  };

  // The opening line belongs to 周菱菱, the character shown on the left.
  const opening = await anchor();
  expect(opening.text).toBe("周菱菱");
  expect(opening.side).toBe("left");
  expect(opening.leftGap).toBeLessThan(opening.rightGap);
  expect(opening.names).toBe(1);

  // 旁白 and 周菱菱 stay left; 孙淼, shown on the right, answers from the right.
  await advance();
  await advance();
  const reply = await advance();
  expect(reply.text).toBe("孙淼");
  expect(reply.side).toBe("right");
  expect(reply.rightGap).toBeLessThan(reply.leftGap);
  expect(reply.names).toBe(1);
  // Symmetric anchor: both names sit the same distance from their own edge.
  expect(Math.abs(reply.rightGap - opening.leftGap)).toBeLessThanOrEqual(2);
});
