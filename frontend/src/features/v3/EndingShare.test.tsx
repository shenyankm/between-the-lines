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

it("keeps selected facts in the modal preview and export and limits selection", async () => {
  render(<EndingShare state={value} />);
  expect(screen.queryByText("复制文案")).toBeNull();
  const choices = screen.getAllByRole<HTMLInputElement>("checkbox");
  for (const choice of choices.slice(0, 3)) fireEvent.click(choice);
  expect(choices[3]!.disabled).toBe(true);
  fireEvent.click(screen.getByText("预览分享卡"));
  await screen.findByText("插画暂时不可用，已生成文字分享卡。");
  const canvas = document.querySelector("canvas")!;
  expect(canvas.hidden).toBe(false);
  expect(canvas.width).toBe(900);
  expect(canvas.height).toBeGreaterThanOrEqual(1600);
  expect(screen.getByRole("dialog", { name: "分享卡预览" })).toBeTruthy();
  const text = canvas.getAttribute("aria-label")!;
  expect(text).toContain("邀请已答应");
  expect(text).not.toContain("错过");
  expect(text).not.toContain("尊重拒绝");
  expect(text).not.toContain("采购待复核");
  fireEvent.click(screen.getByRole("button", { name: "关闭分享卡预览" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByText("预览分享卡"));
  fireEvent.click(choices[0]!);
  fireEvent.click(choices[3]!);
  fireEvent.click(screen.getByText("预览分享卡"));
  const updatedCanvas = document.querySelector("canvas")!;
  await waitFor(() =>
    expect(updatedCanvas.getAttribute("aria-label")).toContain("采购待复核"),
  );
  await waitFor(() => expect(updatedCanvas.hidden).toBe(false));
  expect(updatedCanvas.getAttribute("aria-label")).not.toContain(
    "已参加欢送会",
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(null),
  );
  fireEvent.click(screen.getByText("导出图片"));
  await screen.findByText("导出失败，请重试。");
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

it("closes with Escape and returns focus without exporting", () => {
  render(<EndingShare state={value} />);
  const trigger = screen.getByRole("button", { name: "预览分享卡" });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(clipboardWrite).not.toHaveBeenCalled();
});

it.each(["success", "null-blob", "blob-throws", "url-throws"])(
  "handles local PNG export %s without network sharing",
  async (mode) => {
    const source = { ...value, outcome: null };
    const create = vi.fn(() => {
      if (mode === "url-throws") throw new Error("blocked");
      return "blob:local";
    });
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => {
        if (mode === "blob-throws") throw new Error("canvas unavailable");
        callback(
          mode === "null-blob"
            ? null
            : new Blob(["png"], { type: "image/png" }),
        );
      },
    );
    render(<EndingShare state={source} />);
    fireEvent.click(screen.getByText("预览分享卡"));
    await waitFor(() =>
      expect(screen.getByText<HTMLButtonElement>("导出图片").disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByText("导出图片"));
    if (mode === "success") {
      expect(click).toHaveBeenCalledOnce();
      await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:local"), {
        timeout: 2000,
      });
      expect(screen.getByText("分享图片已导出。")).toBeTruthy();
    } else {
      expect(click).not.toHaveBeenCalled();
      expect(screen.getByText("导出失败，请重试。")).toBeTruthy();
    }
  },
);

it("reports an image rendering failure without enabling an invalid export", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    throw new Error("canvas blocked");
  });
  render(<EndingShare state={value} />);
  fireEvent.click(screen.getByText("预览分享卡"));
  await screen.findByText("图片预览暂时不可用，请关闭后重试。");
  expect(screen.getByText<HTMLButtonElement>("导出图片").disabled).toBe(true);
});
