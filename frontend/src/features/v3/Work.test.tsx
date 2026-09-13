import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Actions, Work, type Option, type StateV3 } from "./Work";
import { SupportForm } from "./SupportForm";
import { save } from "../../testing/fixtures";

const state = {
  ...save().state,
  story_version: 3,
  content_revision: 2,
  node: "act_2",
  tick: 0,
  rumination: 25,
  pressure: 25,
  partner_choice: null,
  exit_draft: null,
  outcome: null,
  quiet_turns: 0,
} as StateV3;
const option = (action: Option["action"], enabled = true): Option => ({
  action,
  enabled,
  label: action,
  completed: false,
  requires_confirmation: false,
  effect: "影响",
  reason: enabled ? "" : "先完成材料",
});
it("requires both essential attachments and preserves the submitted application", () => {
  const submit = vi.fn();
  const props = {
    state,
    act: submit,
    busy: false,
    options: [
      option("submit_purchase"),
      option("supplement"),
      option("report"),
      option("next"),
    ],
  };
  const view = render(<Work {...props} />);
  fireEvent.change(screen.getByLabelText("实验用途"), {
    target: { value: "实验验证" },
  });
  fireEvent.click(screen.getByText("提交第一版申请"));
  expect(submit).toHaveBeenCalledWith("submit_purchase", "sun", {
    params: { purpose: "实验验证" },
  });
  const send = screen.getByText<HTMLButtonElement>("提交所选材料与说明");
  expect(send.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("报价单"));
  expect(send.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("用途说明"));
  fireEvent.click(screen.getByLabelText("加急依据"));
  fireEvent.click(screen.getByLabelText("加急依据"));
  fireEvent.click(send);
  expect(submit).toHaveBeenLastCalledWith("supplement", "sun", {
    params: { evidence: ["quote", "purpose"] },
  });
  fireEvent.click(screen.getByText("report"));
  expect(submit).toHaveBeenLastCalledWith("report", "sun");
  view.rerender(
    <Work
      {...props}
      state={{
        ...state,
        work: {
          purchase: "returned",
          submissions: [
            {
              version: 1,
              purpose: "原申请",
              evidence: ["quote", "purpose", "urgency", "原始附件"],
              event_id: "event-123",
              status: "returned",
              feedback: "缺少说明",
            },
            {
              version: 2,
              purpose: "补充",
              evidence: [],
              event_id: "event-234",
              status: "resubmitted",
              feedback: "",
            },
          ],
          reviews: [
            {
              version: 1,
              actor: "li",
              decision: "退回",
              detail: "缺少说明",
              time: "昨日",
              event_id: "review-1",
            },
          ],
        },
      }}
    />,
  );
  expect(screen.queryByText("提交第一版申请")).toBeNull();
  expect(screen.getByText("原申请")).toBeTruthy();
  expect(screen.getByText(/原始附件/)).toBeTruthy();
  expect(screen.getByText(/缺少说明/)).toBeTruthy();
  view.rerender(<Work {...props} busy />);
  expect(send.disabled).toBe(true);
});
it("previews an exit application without submitting it and allows returning to work", () => {
  const submit = vi.fn();
  render(
    <Work
      state={{
        ...state,
        exit_draft: {
          kind: "transfer",
          reason: "希望转岗",
          event_id: "draft",
          submitted: false,
        },
      }}
      act={submit}
      busy={false}
      options={[option("draft_exit"), option("submit_exit")]}
    />,
  );
  fireEvent.click(screen.getByText("人事申请"));
  fireEvent.change(screen.getByLabelText("申请类型"), {
    target: { value: "withdraw" },
  });
  fireEvent.change(screen.getByLabelText("申请理由"), {
    target: { value: "结束合作" },
  });
  fireEvent.click(screen.getByText("保存并预览"));
  expect(submit).toHaveBeenCalledWith("draft_exit", "sun", {
    params: { kind: "withdraw", reason: "结束合作" },
  });
  expect(screen.getByText("希望转岗")).toBeTruthy();
  fireEvent.click(screen.getByText("submit_exit"));
  expect(submit).toHaveBeenLastCalledWith("submit_exit", "sun");
  fireEvent.click(screen.getByText("采购与项目"));
  expect(screen.getByLabelText("实验用途")).toBeTruthy();
});
it("shows completed and unavailable actions with their reasons, honoring the reviewer", () => {
  const submit = vi.fn();
  const view = render(
    <Actions
      options={[
        { ...option("approve_purchase"), target: "li", completed: true },
        { ...option("next", false) },
        { ...option("report", false), completed: true },
      ]}
      act={submit}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByText("✓ approve_purchase"));
  expect(submit).toHaveBeenCalledWith("approve_purchase", "li");
  expect(screen.getByText("先完成材料")).toBeTruthy();
  view.rerender(<Actions options={[option("report")]} act={submit} busy />);
  expect(screen.getByText<HTMLButtonElement>("report").disabled).toBe(true);
});
it("saves a support draft with an editable handover plan", () => {
  const submit = vi.fn();
  render(<SupportForm state={state} options={[]} act={submit} busy={false} />);
  fireEvent.change(screen.getByLabelText("申请事项"), {
    target: { value: "help" },
  });
  fireEvent.change(screen.getByLabelText("原因"), {
    target: { value: "缺少人手" },
  });
  fireEvent.change(screen.getByLabelText("交接或分工安排"), {
    target: { value: "请求张工分配同事" },
  });
  fireEvent.click(screen.getByText("保存并预览申请"));
  expect(submit).toHaveBeenCalledWith("draft_support", "sun", {
    params: {
      support_kind: "help",
      reason: "缺少人手",
      plan: "请求张工分配同事",
    },
  });
});
it.each(["draft", "submitted", "approval", "completion"] as const)(
  "shows the actual support stage %s and locks only pending applications",
  (stage) => {
    const fact = { event_id: "fact", detail: "已记录", tick: 0 };
    const current = {
      act: 1,
      kind: stage === "draft" ? ("help" as const) : ("leave" as const),
      reason: "原因事实",
      plan: "交接事实",
      draft: fact,
      submitted: stage !== "draft" ? { ...fact, event_id: "submit" } : null,
      approval: ["approval", "completion"].includes(stage)
        ? { ...fact, event_id: "approve" }
        : null,
      completion:
        stage === "completion" ? { ...fact, event_id: "complete" } : null,
    };
    render(
      <SupportForm
        state={{ ...state, support_requests: [current] }}
        options={[
          option("submit_support"),
          option("rest"),
          option("request_help"),
          option("next"),
        ]}
        act={vi.fn()}
        busy={false}
      />,
    );
    expect(
      screen.getByText(
        {
          draft: "草稿，尚未提交",
          submitted: "已提交，等待处理",
          approval: "已获批，等待落实",
          completion: "已落实",
        }[stage],
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>("原因").disabled).toBe(
      ["submitted", "approval"].includes(stage),
    );
  },
);
