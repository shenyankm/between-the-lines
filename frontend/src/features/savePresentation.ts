import type { Save } from "../types";

const endings: Record<string, string> = {
  active_exit: "主动转身",
  career_cost: "付出代价",
  rules_rewritten: "改写规则",
  limited_repair: "有限修复",
  professional_boundary: "各自为界",
  unresolved: "尚未破局",
  cut_ties: "各自为界",
};

export function saveTitle({ state }: Save): string {
  if (!state.ending) return `第 ${state.act} 幕`;
  if ("outcome" in state && state.outcome?.title) return state.outcome.title;
  return (
    endings[state.ending] ??
    (/^[a-z_]+$/i.test(state.ending) ? "故事已结束" : state.ending)
  );
}

export function saveMetrics({ state, story_version }: Save): string {
  return story_version === 3 && "rumination" in state
    ? `专业信用 ${state.credit} · 内耗 ${state.rumination} · 工作压力 ${state.pressure}`
    : `专业信用 ${state.credit} · 心绪消耗 ${state.stress}`;
}
