import type { Action, GameState } from "../../types";

// Presentation of confirmed server facts only; the backend still validates every action.
const completedBy: Partial<Record<Action, string>> = {
  begin: "started",
  contact_wang: "wang_contacted",
  boundary: "boundary",
  public_confront: "confronted",
  supplement: "materials",
  report: "reported",
  clarify: "clarified",
  deliver: "delivered",
  cut_ties: "sun_cut",
  keep_distance: "sun_observe",
};
export function choiceProgress(state: GameState, action: Action) {
  const flag = completedBy[action];
  const completed = !!flag && state.flags.includes(flag);
  const waiting =
    action === "supplement" && !state.flags.includes("requirements");
  return {
    completed,
    disabled: completed || waiting,
    reason: waiting ? "先向财务确认材料要求" : "",
  };
}
export function nextStep(state: GameState): {
  ready: boolean;
  message: string;
} {
  const has = (flag: string) => state.flags.includes(flag);
  if (state.act === 1) {
    const ready = ["wang_contacted", "boundary", "confronted"].some(has);
    return {
      ready,
      message: ready
        ? "这一步已经完成，可以继续故事，也可以选择其他回应。"
        : "先选择一种回应，再继续故事。",
    };
  }
  if (state.act === 2) {
    if (state.procurement === "approved")
      return { ready: true, message: "采购审核已通过，可以继续故事。" };
    return {
      ready: false,
      message: !has("requirements")
        ? "先与孙淼或李姐对话，确认材料要求。"
        : !has("materials")
          ? "要求已确认，请补齐采购材料。"
          : "材料已提交，请切换到李姐并请求审核。张工可以支持项目，但不能代替财务审批。",
    };
  }
  if (state.act === 3) {
    const ready =
      has("clarified") &&
      has("delivered") &&
      (has("sun_cut") || has("sun_observe"));
    return {
      ready,
      message: ready
        ? has("sun_cut")
          ? "已选择：结束私人来往，仅保留工作沟通。可以继续故事。"
          : "已选择：保持距离继续观察（游戏分支）。可以继续故事。"
        : has("clarified") && has("delivered")
          ? "工作事项已完成。现在由你决定与孙淼的私人关系。"
          : "先完成澄清与交付，再选择如何处理与孙淼的私人关系。",
    };
  }
  return { ready: false, message: "" };
}
