import type { Action, GameState } from "../../types";

const completedFlags: Partial<Record<Action, string>> = {
  begin: "started",
  contact_wang: "wang_contacted",
  boundary: "boundary",
  public_confront: "confronted",
  supplement: "materials",
  report: "reported",
  clarify: "clarified",
  deliver: "delivered",
  repair: "repaired",
  written_record: "written_record",
  document_rumor: "rumor_documented",
};

// UI guidance only: the server still validates every action against current state.
export function actionUnavailable(state: GameState, action: Action): string {
  const flags = new Set(state.flags);
  if (
    (action === "repair" || action === "written_record") &&
    !flags.has("confronted")
  )
    return "当前没有公开冲突";
  if (
    (action === "repair" && flags.has("written_record")) ||
    (action === "written_record" && flags.has("repaired"))
  )
    return "已选择另一种处理方式";
  if (
    (action === "clarify" && flags.has("rumor_documented")) ||
    (action === "document_rumor" && flags.has("clarified"))
  )
    return "已选择另一种处理方式";
  if (
    ["clarify", "document_rumor"].includes(action) &&
    state.flags.some((f) => ["resolve_rumor", "publish_rumor"].includes(f))
  )
    return "已选择另一种处理方式";
  const flag = completedFlags[action];
  if (flag && state.flags.includes(flag)) return "已完成";
  if (action === "supplement" && !state.flags.includes("requirements"))
    return "先向财务确认缺少的材料";
  return "";
}

export function nextStep(state: GameState): string {
  const flags = new Set(state.flags);
  if (flags.has("company_review") && !flags.has("attend_review"))
    return "请先在调查面板参加公司协调。";
  if (state.stress >= 80) return "内耗过高，请先在调查面板休整，或选择离开。";
  if (
    state.act === 1 &&
    !["wang_contacted", "boundary", "confronted"].some((f) => flags.has(f))
  )
    return "聊清楚后，从上方选择一个行动，决定怎样回应这件事。";
  if (state.act === 2 && state.procurement !== "approved") {
    if (!flags.has("requirements"))
      return "先向孙淼或李姐确认缺少哪些采购材料。";
    if (!flags.has("materials"))
      return "材料要求已明确，现在可以补齐采购材料。";
    return "材料已提交。打开手机联系李姐，请她审核采购。";
  }
  if (
    state.act === 3 &&
    ((!flags.has("clarified") &&
      !flags.has("rumor_documented") &&
      !flags.has("resolve_rumor") &&
      !flags.has("publish_rumor")) ||
      !flags.has("delivered"))
  )
    return "选择公开澄清或私下核实，再提交实验结果后，再继续故事。";
  return "";
}
