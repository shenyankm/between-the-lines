import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { save } from "../../testing/fixtures";
import type { StateV3 } from "./Work";
import { EndingShare } from "./EndingShare";
import { drawShareCard, wrapText } from "./shareCard";

const clipboardWrite = vi.fn<(text: string) => Promise<void>>();
const context = {
  fillText: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  drawImage: vi.fn(),
  measureText: (text: string) => ({ width: Array.from(text).length * 30 }),
};
const value = {
  ...save().state,
  story_version: 3,
  content_revision: 2,
  rumination: 25,
  pressure: 30,
  outcome: {
    id: "limited_repair",
    title: "有限修复",
    achievements: ["已参加欢送会", "已完成补救", "邀请已答应"],
    unresolved: ["采购待复核"],
    key_event_ids: [],
  },
} as StateV3;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onerror?.());
      }
    },
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite.mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps selected facts identical across preview, copy and export and limits selection", async () => {
  render(<EndingShare state={value} />);
  fireEvent.click(screen.getByText("复制文案"));
  await screen.findByText("文案已复制");
  expect(clipboardWrite.mock.calls[0]![0]).not.toContain("已参加欢送会");
  const choices = screen.getAllByRole<HTMLInputElement>("checkbox");
  for (const choice of choices.slice(0, 3)) fireEvent.click(choice);
  expect(choices[3]!.disabled).toBe(true);
  fireEvent.click(screen.getByText("预览分享卡"));
  await screen.findByText("插画暂时不可用，已生成文字分享卡。");
  const canvas = document.querySelector("canvas")!;
  expect(canvas.hidden).toBe(false);
  expect(canvas.width).toBe(900);
  expect(canvas.height).toBeGreaterThanOrEqual(1600);
  fireEvent.click(screen.getByText("复制文案"));
  await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(2));
  const text = clipboardWrite.mock.calls.at(-1)![0];
  expect(canvas.getAttribute("aria-label")).toBe(text);
  expect(text).toContain("邀请已答应");
  expect(text).not.toContain("错过");
  expect(text).not.toContain("尊重拒绝");
  expect(text).not.toContain("采购待复核");
  fireEvent.click(choices[0]!);
  fireEvent.click(choices[3]!);
  await waitFor(() =>
    expect(canvas.getAttribute("aria-label")).toContain("采购待复核"),
  );
  await waitFor(() => expect(canvas.hidden).toBe(false));
  expect(canvas.getAttribute("aria-label")).not.toContain("已参加欢送会");
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(null),
  );
  fireEvent.click(screen.getByText("导出图片"));
  await screen.findByText("导出失败，请重试或复制文案。");
});

it("wraps measured text without splitting emoji and grows the canvas for long facts", () => {
  const ctx = context as unknown as CanvasRenderingContext2D;
  expect(wrapText(ctx, "你😀好\n第二行", 60)).toEqual([
    "你😀",
    "好",
    "第二",
    "行",
  ]);
  const canvas = document.createElement("canvas");
  drawShareCard(
    canvas,
    ["本局已收束", "尚未破局", "已确认的长事实".repeat(400)],
    null,
  );
  expect(canvas.height).toBeGreaterThan(1600);
  const calls = context.fillText.mock.calls;
  expect(Math.max(...calls.map((call) => call[2] as number))).toBeLessThan(
    canvas.height - 80,
  );
});

it("disables exporting stale pixels while a new preview waits for fonts", async () => {
  let ready!: () => void;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
    },
  });
  render(<EndingShare state={value} />);
  fireEvent.click(screen.getByText("预览分享卡"));
  expect(screen.getByText<HTMLButtonElement>("导出图片").disabled).toBe(true);
  ready();
  await waitFor(() =>
    expect(screen.getByText<HTMLButtonElement>("导出图片").disabled).toBe(
      false,
    ),
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: undefined,
  });
});
