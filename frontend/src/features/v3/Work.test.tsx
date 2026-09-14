import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Actions, Work, type Option, type StateV3 } from "./Work";
import { SupportForm } from "./SupportForm";
import { save } from "../../testing/fixtures";

const defaultForm = {
  applicant: "周菱菱",
  department: "研发工位",
  material_category: "电子元器件",
  quantity: 100,
  budget: "研发项目经费",
  expected_arrival: "2026-09-20",
  notes: "",
};

const state = {
  ...save().state,
  act: 2,
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
const returnedWork: NonNullable<StateV3["work"]> = {
  purchase: "returned",
  facts: {},
  reviews: [],
  submissions: [
    {
      version: 1,
      event_id: "purchase-1",
      kind: "standard",
      purpose: "用于新产品试制与功能验证。",
      evidence: [],
      status: "returned",
      feedback: "",
      supplement_note: "",
      mentions: [],
      purchase_form: null,
      submitted_at: "",
    },
  ],
};
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
    params: {
      purpose: "实验验证",
      purchase_form: defaultForm,
      purchase_kind: "standard",
    },
  });
  view.rerender(<Work {...props} state={{ ...state, work: returnedWork }} />);
  const send = screen.getByRole<HTMLButtonElement>("button", {
    name: "提交所选材料与说明",
  });
  expect(send.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("报价单"));
  expect(send.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("用途说明"));
  fireEvent.click(screen.getByLabelText("加急依据"));
  fireEvent.click(screen.getByLabelText("加急依据"));
  fireEvent.click(send);
  expect(submit).toHaveBeenLastCalledWith("supplement", "sun", {
    params: {
      evidence: ["quote", "purpose"],
      purpose: "实验验证",
      purchase_form: defaultForm,
    },
  });
  expect(screen.queryByText("后续工作事项")).toBeNull();
  expect(screen.queryByRole("button", { name: "report" })).toBeNull();
  view.rerender(
    <Work
      {...props}
      state={{
        ...state,
        work: {
          purchase: "returned",
          submissions: [
            {
              purchase_form: null,
              submitted_at: "",
              supplement_note: "",
              kind: "standard",
              version: 1,
              purpose: "原申请",
              evidence: ["quote", "purpose", "urgency", "原始附件"],
              event_id: "event-123",
              status: "returned",
              feedback: "缺少说明",
            },
            {
              purchase_form: null,
              submitted_at: "",
              supplement_note: "",
              kind: "standard",
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
  view.rerender(
    <Work {...props} state={{ ...state, work: returnedWork }} busy />,
  );
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
it("shows a submitted exit as submitted while leaving an unsubmitted draft distinct", () => {
  const draft = {
    kind: "transfer" as const,
    reason: "希望转岗",
    event_id: "exit",
    submitted: false,
  };
  const view = render(
    <Work
      state={{ ...state, exit_draft: draft }}
      options={[]}
      act={vi.fn()}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByText("人事申请"));
  expect(screen.getByText("申请预览 · 尚未提交")).toBeTruthy();
  view.rerender(
    <Work
      state={{
        ...state,
        ending: "主动转身",
        exit_draft: { ...draft, submitted: true },
      }}
      options={[]}
      act={vi.fn()}
      busy={false}
    />,
  );
  expect(screen.queryByText("申请预览 · 尚未提交")).toBeNull();
  expect(screen.getByText("退出申请 · 已提交")).toBeTruthy();
  expect(
    screen.getByText("手续仍待后续办理，不代表已获批准或完成交接。"),
  ).toBeTruthy();
});
it("saves a support draft with an editable handover plan", () => {
  const submit = vi.fn();
  render(
    <SupportForm
      state={state}
      options={[option("draft_support")]}
      act={submit}
      busy={false}
    />,
  );
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

it("does not submit support requests when the server withholds the action", () => {
  const submit = vi.fn();
  render(
    <SupportForm
      state={state}
      options={[option("draft_support", false)]}
      act={submit}
      busy={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("原因"), {
    target: { value: "需要帮助" },
  });
  fireEvent.change(screen.getByLabelText("交接或分工安排"), {
    target: { value: "交接安排" },
  });
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "保存并预览申请",
  });
  expect(button.disabled).toBe(true);
  expect(screen.getByText("先完成材料")).toBeTruthy();
  fireEvent.submit(button.closest("form")!);
  expect(submit).not.toHaveBeenCalled();
});

it("requires urgency evidence only when the player explicitly selects urgent procurement", () => {
  const action = vi.fn();
  render(
    <Work
      state={{ ...state, content_revision: 3, work: returnedWork }}
      options={[option("supplement")]}
      act={action}
      busy={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("本次采购类型"), {
    target: { value: "urgent" },
  });
  fireEvent.click(screen.getByLabelText("报价单"));
  fireEvent.click(screen.getByLabelText("用途说明"));
  expect(
    screen
      .getByRole("button", { name: "提交所选材料与说明" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByLabelText("加急依据"));
  fireEvent.click(screen.getByRole("button", { name: "提交所选材料与说明" }));
  expect(action).toHaveBeenCalledWith("supplement", "sun", {
    params: {
      evidence: ["quote", "purpose", "urgency"],
      purchase_kind: "urgent",
      purpose: "用于新产品试制与功能验证。",
      purchase_form: defaultForm,
    },
  });
});

it("restores unsaved HR input on remount, separates forms, and can clear it explicitly", () => {
  const props = {
    state,
    options: [option("draft_exit"), option("draft_support")],
    act: vi.fn(),
    busy: false,
    draftIdentity: { userId: "hr-remount", saveId: "draft-save" },
  };
  const first = render(<Work {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "人事申请" }));
  fireEvent.change(screen.getByLabelText("申请理由"), {
    target: { value: "未保存的理由" },
  });
  fireEvent.change(screen.getByLabelText("原因", { exact: true }), {
    target: { value: "请假原因" },
  });
  fireEvent.change(screen.getByLabelText("申请事项"), {
    target: { value: "help" },
  });
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("原因", { exact: true }).value,
  ).toBe("");
  first.unmount();
  render(<Work {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "人事申请" }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("申请理由").value).toBe(
    "未保存的理由",
  );
  fireEvent.change(screen.getByLabelText("申请事项"), {
    target: { value: "leave" },
  });
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("原因", { exact: true }).value,
  ).toBe("请假原因");
  fireEvent.click(screen.getByRole("button", { name: "清空退出申请输入" }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("申请理由").value).toBe("");
  expect(props.act).not.toHaveBeenCalled();
});

it("rejects whitespace fields locally while retaining input for correction", () => {
  const submit = vi.fn();
  render(
    <Work
      state={state}
      options={[option("draft_exit"), option("draft_support")]}
      act={submit}
      busy={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "人事申请" }));
  fireEvent.change(screen.getByLabelText("申请理由"), {
    target: { value: "   " },
  });
  fireEvent.submit(screen.getByLabelText("申请理由").closest("form")!);
  expect(screen.getByText("请填写申请理由，不能只输入空格。")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("原因", { exact: true }), {
    target: { value: "   " },
  });
  fireEvent.submit(
    screen.getByLabelText("原因", { exact: true }).closest("form")!,
  );
  expect(screen.getByText("请填写交接或分工安排。")).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
});

it("restores the purchase purpose after closing without submitting it", () => {
  const submit = vi.fn();
  const props = {
    state,
    options: [option("submit_purchase")],
    act: submit,
    busy: false,
    draftIdentity: { userId: "purchase-draft", saveId: "purchase-save" },
  };
  const view = render(<Work {...props} />);
  fireEvent.change(screen.getByLabelText("实验用途"), {
    target: { value: "下一批实验用途" },
  });
  view.unmount();
  render(<Work {...props} />);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "实验用途" })
      .value,
  ).toBe("下一批实验用途");
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLInputElement>("数量").value).toBe("100");
});

it("requires a note and recipients for the scene entry and restores the whole draft", () => {
  const act = vi.fn();
  const props = {
    state: {
      ...state,
      act: 2,
      work: {
        purchase: "returned" as const,
        facts: {},
        reviews: [],
        submissions: [
          {
            kind: "standard" as const,
            version: 1,
            event_id: "first",
            purpose: "实验",
            evidence: [],
            status: "returned" as const,
            feedback: "",
            purchase_form: null,
            submitted_at: "",
            supplement_note: "",
          },
        ],
      },
    },
    options: [option("supplement")],
    act,
    busy: false,
    requireMentions: true,
    draftIdentity: { userId: "mentions-test", saveId: "draft-save" },
  };
  const v = render(<Work {...props} />);
  const submit = () =>
    screen.getByRole<HTMLButtonElement>("button", {
      name: "提交所选材料与说明",
    });
  fireEvent.click(screen.getByLabelText("报价单"));
  fireEvent.click(screen.getByLabelText("用途说明"));
  expect(submit().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("补充说明"), {
    target: { value: "请按模板核对" },
  });
  expect(submit().disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/李姐 · 财务审核/));
  fireEvent.click(screen.getByLabelText(/张工 · 研发负责人/));
  expect(submit().disabled).toBe(false);
  fireEvent.click(submit());
  expect(act).toHaveBeenCalledWith("supplement", "sun", {
    params: {
      evidence: ["quote", "purpose"],
      supplement_note: "请按模板核对",
      purpose: "实验",
      purchase_form: defaultForm,
      mentions: ["li", "zhang"],
    },
  });
  v.unmount();
  const restored = render(<Work {...props} />);
  expect(screen.getByLabelText<HTMLTextAreaElement>("补充说明").value).toBe(
    "请按模板核对",
  );
  expect(screen.getByLabelText<HTMLInputElement>("报价单").checked).toBe(true);
  expect(
    screen.getByLabelText<HTMLInputElement>(/张工 · 研发负责人/).checked,
  ).toBe(true);
  restored.rerender(<Work {...props} busy />);
  expect(submit().disabled).toBe(true);
  restored.rerender(
    <Work
      {...props}
      state={{
        ...props.state,
        work: {
          ...props.state.work,
          submissions: [
            {
              ...props.state.work.submissions[0]!,
              version: 2,
              supplement_note: "已保存说明",
              mentions: ["li", "zhang"],
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByText("补充说明：已保存说明")).toBeTruthy();
  expect(screen.getByText("已通知：李姐、张工")).toBeTruthy();
});

it("restores all editable purchase fields and submits their entered values", () => {
  const act = vi.fn();
  const props = {
    state,
    act,
    busy: false,
    options: [option("submit_purchase")],
    draftIdentity: { userId: "form-user", saveId: "editable-form" },
  };
  const view = render(<Work {...props} />);
  expect(screen.getByLabelText<HTMLInputElement>("材料类别").value).toBe(
    "电子元器件",
  );
  expect(screen.getByLabelText<HTMLInputElement>("预计到货日期").value).toBe(
    "2026-09-20",
  );
  for (const [label, value] of [
    ["申请人", "周菱菱（研发）"],
    ["所属部门", "研发二组"],
    ["材料类别", "传感器"],
    ["数量", "250"],
    ["预算归属", "试制经费"],
    ["预计到货日期", "2026-10-01"],
    ["备注", "分批送达"],
    ["实验用途", "样机验证"],
  ] as const)
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  view.unmount();
  render(<Work {...props} />);
  expect(screen.getByLabelText<HTMLInputElement>("数量").value).toBe("250");
  expect(screen.getByLabelText<HTMLTextAreaElement>("备注").value).toBe(
    "分批送达",
  );
  fireEvent.click(screen.getByRole("button", { name: "提交第一版申请" }));
  expect(act).toHaveBeenCalledWith("submit_purchase", "sun", {
    params: {
      purpose: "样机验证",
      purchase_kind: "standard",
      purchase_form: {
        applicant: "周菱菱（研发）",
        department: "研发二组",
        material_category: "传感器",
        quantity: 250,
        budget: "试制经费",
        expected_arrival: "2026-10-01",
        notes: "分批送达",
      },
    },
  });
});

it("saves chapter-one drafts without a turn and enables chapter-two resubmission with existing attachments", () => {
  const act = vi.fn();
  const draftIdentity = { userId: "stage-user", saveId: "stage-draft" };
  const view = render(
    <Work
      state={{ ...state, act: 1 }}
      options={[]}
      act={act}
      busy={false}
      draftIdentity={draftIdentity}
    />,
  );
  expect(screen.queryByRole("button", { name: "提交第一版申请" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "提交所选材料与说明" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("备注"), {
    target: { value: "请核对交期" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  expect(screen.getByText("草稿已暂存 · 尚未提交")).toBeTruthy();
  expect(act).not.toHaveBeenCalled();
  view.unmount();
  render(
    <Work
      state={{
        ...state,
        content_revision: 3,
        work: {
          ...returnedWork,
          submissions: [
            {
              ...returnedWork.submissions![0]!,
              evidence: ["quote", "purpose"],
            },
          ],
        },
      }}
      options={[option("supplement")]}
      act={act}
      busy={false}
      draftIdentity={draftIdentity}
    />,
  );
  expect(screen.getByLabelText<HTMLTextAreaElement>("备注").value).toBe(
    "请核对交期",
  );
  expect(screen.getByLabelText<HTMLInputElement>("报价单").checked).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>("用途说明").checked).toBe(
    true,
  );
  const resubmit = screen.getByRole<HTMLButtonElement>("button", {
    name: "提交所选材料与说明",
  });
  expect(resubmit.disabled).toBe(false);
  fireEvent.click(resubmit);
  expect(act).toHaveBeenCalledWith("supplement", "sun", {
    params: {
      evidence: ["quote", "purpose"],
      purpose: "用于新产品试制与功能验证。",
      purchase_kind: "standard",
      purchase_form: { ...defaultForm, notes: "请核对交期" },
    },
  });
});

it("uses persisted form defaults and displays every review without rewriting history", () => {
  const form = {
    ...defaultForm,
    applicant: "实际申请人",
    quantity: 320,
    notes: "分批验收",
  };
  const first = {
    ...returnedWork.submissions![0]!,
    purchase_form: form,
    submitted_at: "2026-09-07 09:20",
    evidence: ["legacy-file"],
    mentions: ["li" as const],
    supplement_note: "原始补充说明",
  };
  const second = {
    ...first,
    version: 2,
    event_id: "v2",
    kind: "urgent" as const,
    status: "approved" as const,
    evidence: ["quote", "purpose", "urgency"],
  };
  const work = {
    purchase: "approved" as const,
    facts: {},
    submissions: [first, second],
    reviews: [
      {
        event_id: "r1",
        version: 1,
        actor: "sun" as const,
        decision: "退回",
        detail: "旧版缺少说明",
        time: "2026-09-08 14:32",
      },
      {
        event_id: "r2",
        version: 2,
        actor: "li" as const,
        decision: "通过",
        detail: "复核通过",
        time: "2026-09-09 10:00",
      },
    ],
  };
  const snapshot = JSON.stringify(work);
  render(
    <Work state={{ ...state, work }} options={[]} act={vi.fn()} busy={false} />,
  );
  expect(screen.getByLabelText<HTMLInputElement>("申请人").value).toBe(
    "实际申请人",
  );
  expect(screen.getByLabelText<HTMLInputElement>("数量").value).toBe("320");
  expect(screen.getByLabelText<HTMLTextAreaElement>("备注").value).toBe(
    "分批验收",
  );
  expect(screen.getByText("旧版缺少说明")).toBeTruthy();
  expect(screen.getByText("复核通过")).toBeTruthy();
  expect(screen.getByText("附件：legacy-file")).toBeTruthy();
  expect(screen.getAllByText("已通知：李姐")).toHaveLength(2);
  expect(JSON.stringify(work)).toBe(snapshot);
});

it("opens attachments independently of selection and prevents invalid resubmission", () => {
  const act = vi.fn();
  const work = {
    ...returnedWork,
    submissions: [
      { ...returnedWork.submissions![0]!, evidence: ["quote", "purpose"] },
    ],
  };
  render(
    <Work
      state={{ ...state, work }}
      options={[option("supplement")]}
      act={act}
      busy={false}
    />,
  );
  fireEvent.click(screen.getAllByRole("button", { name: /点击查看/ })[0]!);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭附件预览" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("报价单").checked).toBe(true);
  fireEvent.change(screen.getByLabelText("数量"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "提交所选材料与说明" }));
  expect(act).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLInputElement>("数量").checkValidity()).toBe(
    false,
  );
});
