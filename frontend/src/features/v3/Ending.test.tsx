import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
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
        result: {
          text: "已确认的经历。\n\n尚未解决的工作，仍按记录保留。",
          label: "AI 演出",
          interactions: [{ event_summary: "不应另列的互动报告" }],
        },
      }),
    ),
  );
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Ending userId="reader" save={save()} state={value} />
    </QueryClientProvider>,
  );
}
function finishOpening() {
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  fireEvent.click(screen.getByRole("button", { name: "查看本局结算" }));
}
it.each([
  ["rules_rewritten", "改写规则", "E01", "rules"],
  ["professional_boundary", "各自为界", "E02", "boundary"],
  ["limited_repair", "有限修复", "E03", "repair"],
  ["active_exit", "主动转身", "E04", "exit"],
  ["career_cost", "付出代价", "E05", "cost"],
  ["unresolved", "尚未破局", "E06", "unresolved"],
] as const)(
  "shows only the %s card with its own text and art",
  (id, title, code, asset) => {
    mount(
      state({
        ending: title,
        outcome: {
          id,
          title,
          achievements: ["已确认事实"],
          unresolved: ["待处理事项"],
          key_event_ids: [],
        },
      }),
    );
    expect(screen.queryByRole("region", { name: "故事结局" })).toBeNull();
    finishOpening();
    expect(screen.getByRole("img").getAttribute("alt")).toBe(
      `${code} ${title}：文档原版结局卡片`,
    );
    expect(screen.getByRole("img").getAttribute("src")).toContain(
      `ending-${asset}-941-`,
    );
    expect(screen.queryByText("已确认的经历。")).toBeNull();
    for (const text of [
      "结局回顾",
      "已保存事实",
      "回看关键互动",
      "我的职场人格",
      "留下一张本局记录",
      "复制文案",
      "不应另列的互动报告",
      "AI 演出",
    ])
      expect(screen.queryByText(text)).toBeNull();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("结局卡片暂时未能加载，请刷新重试。")).toBeTruthy();
  },
);
it("keeps unknown historical endings readable without assigning a new type", () => {
  mount(state({ ending: "历史结局" }));
  finishOpening();
  expect(screen.getByRole("heading", { name: "历史结局" })).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.queryByText("已确认的经历。")).toBeNull();
});
it.each(["transfer", "withdraw", "resign"] as const)(
  "preserves submitted %s and completed work in opening",
  (kind) => {
    mount(
      state({
        exit_draft: {
          kind,
          reason: "自主选择",
          event_id: "exit",
          submitted: true,
        },
        work: {
          purchase: "approved",
          submissions: [],
          reviews: [],
          facts: { delivered: { event_id: "d", detail: "交付完成" } },
        },
      }),
    );
    expect(screen.getByText(/采购申请已经通过审核/)).toBeTruthy();
    expect(screen.getByText(/项目交付已经留下记录/)).toBeTruthy();
    expect(screen.queryByText(/还要继续维持吗/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(
      screen.getByText(
        new RegExp(
          `我已经提交了${kind === "transfer" ? "转岗" : kind === "withdraw" ? "退出项目" : "离职"}申请`,
        ),
      ),
    ).toBeTruthy();
  },
);
it.each(["undecided", "friendship", "professional"] as const)(
  "preserves the player's %s intention without declaring forgiveness",
  (intention) => {
    mount(
      state({
        relationship: {
          intention,
          facts: { boundary: { event_id: "b", detail: "明确边界" } },
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByText(/边界不是翻脸/)).toBeTruthy();
    expect(screen.queryByText(/已经原谅/)).toBeNull();
  },
);
