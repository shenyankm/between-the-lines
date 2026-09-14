import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { server } from "../../testing/server";
import { save } from "../../testing/fixtures";
import type { StateV3 } from "./Work";
import { Ending } from "./Ending";
function state(over: Partial<StateV3> = {}): StateV3 {
  return {
    ...save().state,
    story_version: 3,
    content_revision: 2,
    node: "ending",
    tick: 1,
    rumination: 25,
    pressure: 25,
    partner_choice: null,
    exit_draft: null,
    outcome: null,
    quiet_turns: 0,
    ...over,
  };
}
function mount(value: StateV3) {
  server.use(
    http.post("/api/saves/save-1/jobs", () =>
      HttpResponse.json({
        id: "ending",
        kind: "ending",
        status: "completed",
        result: { text: "已确认的经历" },
      }),
    ),
  );
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Ending userId="test-user" save={save()} state={value} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  [20, "professional", "清晰守界"],
  [50, "friendship", "审慎修复"],
  [80, "undecided", "主动表达"],
] as const)(
  "presents facts and costs at metric %s without inventing an outcome",
  async (value, intention, style) => {
    mount(
      state({
        heat: value,
        credit: value,
        rumination: value,
        pressure: value,
        relationship: {
          intention,
          facts: { boundary: { event_id: "fact", detail: "已表达边界" } },
        },
        outcome: {
          id: "unresolved",
          title: "仍在观察",
          achievements: ["完成工作"],
          unresolved: ["争议待核实"],
          key_event_ids: [],
        },
      }),
    );
    expect(screen.getByText(`本局表达倾向 · ${style}`)).toBeTruthy();
    expect(screen.getByText("完成工作")).toBeTruthy();
    expect(screen.getByText("争议待核实")).toBeTruthy();
    await screen.findByText("已确认的经历");
  },
);
it("previews locally and handles copy failure without sharing private messages", async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  const draw = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 30 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    draw as unknown as CanvasRenderingContext2D,
  );
  const saveImage = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((cb) => cb(new Blob(["image"])));
  const create = vi.fn(() => "blob:local-card"),
    revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  mount(state());
  expect(screen.getByText("本局表达倾向 · 保留空间")).toBeTruthy();
  fireEvent.click(screen.getByText("复制文案"));
  await screen.findByText("文案已复制");
  expect(write.mock.calls[0]?.[0]).toContain("不是心理测评");
  write.mockRejectedValue(new Error("denied"));
  fireEvent.click(screen.getByText("复制文案"));
  await screen.findByText("复制失败，请从预览手动复制");
  fireEvent.click(screen.getByText("预览分享卡"));
  await waitFor(() => expect(draw.fillText).toHaveBeenCalled());
  fireEvent.click(screen.getByText("导出图片"));
  expect(saveImage).toHaveBeenCalledOnce();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:local-card"), {
    timeout: 2000,
  });
  toBlob.mockImplementation((cb) => cb(null));
  fireEvent.click(screen.getByText("导出图片"));
  expect(saveImage).toHaveBeenCalledOnce();
});
it("keeps text readable if canvas is unsupported", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mount(state());
  fireEvent.click(screen.getByText("预览分享卡"));
  await screen.findByText("已确认的经历");
  expect(screen.getByText("导出图片")).toBeTruthy();
});
