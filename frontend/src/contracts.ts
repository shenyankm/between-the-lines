/** Runtime checks at the HTTP/storage boundary. Extra response fields are harmless. */
import type {
  Action,
  Config,
  GameEvent,
  Npc,
  PlayState,
  Result,
  Save,
  Story,
  Turn,
  User,
} from "./types";
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const strings = (v: Record<string, unknown>, fields: string[]) =>
  fields.every((k) => typeof v[k] === "string");
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const actions: Record<Action, true> = {
  request_materials: true,
  approve_purchase: true,
  support_project: true,
  verify_notice: true,
  join_farewell: true,
  attend_farewell: true,
  joint_review: true,
  partner_breakup: true,
  partner_distance: true,
  propose: true,
  cancel_proposal: true,
  speak: true,
  begin: true,
  contact_wang: true,
  boundary: true,
  public_confront: true,
  next: true,
  supplement: true,
  report: true,
  clarify: true,
  review_clarification: true,
  deliver: true,
  cut_ties: true,
  keep_distance: true,
  leave: true,
  epilogue: true,
  submit_purchase: true,
  dispute_return: true,
  trace_rumor: true,
  confirm_responsibility: true,
  change_rules: true,
  apply_rules: true,
  repair_friendship: true,
  acknowledge_harm: true,
  complete_remedy: true,
  follow_up: true,
  partner_undecided: true,
  rest: true,
  draft_support: true,
  submit_support: true,
  review_support: true,
  request_help: true,
  appease: true,
  request_extension: true,
  project_review: true,
  correct_loss: true,
  draft_exit: true,
  submit_exit: true,
  close_story: true,
};
export const isAction = (v: unknown): v is Action =>
  typeof v === "string" && Object.hasOwn(actions, v);
export const isNpc = (v: unknown): v is Npc =>
  v === "sun" || v === "li" || v === "zhang" || v === "wang";
export function isSave(v: unknown): v is Save {
  if (
    !record(v) ||
    typeof v.id !== "string" ||
    !integer(v.version) ||
    !record(v.state)
  )
    return false;
  const s = v.state;
  return (
    (v.relationships === undefined ||
      (Array.isArray(v.relationships) &&
        v.relationships.every(
          (r) => record(r) && strings(r, ["id", "name", "role", "description"]),
        ))) &&
    (v.ending_summary == null || typeof v.ending_summary === "string") &&
    (v.npc_greetings === undefined ||
      (record(v.npc_greetings) &&
        Object.entries(v.npc_greetings).every(
          ([key, text]) => isNpc(key) && typeof text === "string",
        ))) &&
    integer(s.act, 4) &&
    [s.credit, s.stress, s.heat].every((n) => integer(n, 100)) &&
    Array.isArray(s.flags) &&
    s.flags.every((n) => typeof n === "string") &&
    (s.procurement === "pending" || s.procurement === "approved") &&
    (s.ending === null || typeof s.ending === "string")
  );
}
export function isResult(v: unknown): v is Result {
  if (
    !record(v) ||
    !["completed", "failed"].includes(String(v.status)) ||
    typeof v.turn_id !== "string" ||
    !isSave(v.save)
  )
    return false;
  const failure = v.failure;
  return (
    (v.text == null || typeof v.text === "string") &&
    (v.retryable === undefined || typeof v.retryable === "boolean") &&
    (failure == null ||
      (v.status === "failed" &&
        record(failure) &&
        strings(failure, ["code", "message"]) &&
        (failure.request_id == null ||
          typeof failure.request_id === "string") &&
        failure.recovery === "refresh"))
  );
}
export function isUser(v: unknown): v is User {
  return record(v) && strings(v, ["id", "name"]);
}
export function isConfig(v: unknown): v is Config {
  return (
    record(v) &&
    [v.dev_login, v.zhihu_login, v.model_ready].every(
      (n) => typeof n === "boolean",
    ) &&
    (v.agent_mode === "mock" ||
      v.agent_mode === "deepseek" ||
      v.agent_mode === "openai")
  );
}
export function isEvent(v: unknown): v is GameEvent {
  return (
    record(v) &&
    strings(v, ["id", "text"]) &&
    isNpc(v.npc) &&
    ["player", "npc", "work", "epilogue", "personal", "narrative"].includes(
      String(v.kind),
    ) &&
    (v.act == null || integer(v.act, 4)) &&
    (v.action == null || isAction(v.action))
  );
}
export function isPlayState(v: unknown): v is PlayState {
  return (
    record(v) &&
    isSave(v.save) &&
    (v.performance_version == null || integer(v.performance_version)) &&
    (v.performance === undefined ||
      (Array.isArray(v.performance) &&
        v.performance.every(
          (line) =>
            record(line) &&
            strings(line, ["id", "speaker", "text"]) &&
            Array.isArray(line.portraits) &&
            line.portraits.every((p) => typeof p === "string") &&
            (line.location == null || typeof line.location === "string") &&
            (line.background == null ||
              (typeof line.background === "string" &&
                line.background.startsWith("/assets/") &&
                !line.background.includes(".."))),
        ))) &&
    (v.available_actions === undefined ||
      (Array.isArray(v.available_actions) &&
        v.available_actions.every(
          (a) =>
            record(a) &&
            isAction(a.action) &&
            typeof a.label === "string" &&
            typeof a.enabled === "boolean" &&
            typeof a.completed === "boolean" &&
            typeof a.requires_confirmation === "boolean" &&
            (a.target == null || isNpc(a.target)) &&
            typeof a.effect === "string" &&
            typeof a.reason === "string",
        ))) &&
    (v.proposal == null ||
      (record(v.proposal) &&
        typeof v.proposal.id === "string" &&
        isAction(v.proposal.action) &&
        integer(v.proposal.version) &&
        strings(v.proposal, ["label", "effect"]))) &&
    (v.ai === undefined ||
      (record(v.ai) &&
        typeof v.ai.available === "boolean" &&
        (v.ai.remaining == null || integer(v.ai.remaining)))) &&
    Array.isArray(v.events) &&
    v.events.every(isEvent) &&
    (v.active_turn === null ||
      (record(v.active_turn) && strings(v.active_turn, ["id", "request_id"])))
  );
}
export function isTurn(v: unknown): v is Turn {
  if (!record(v) || typeof v.id !== "string" || !record(v.usage)) return false;
  const u = v.usage;
  if (
    ![
      "model_calls",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "elapsed_ms",
    ].every((k) => u[k] === undefined || integer(u[k])) ||
    (u.model != null && typeof u.model !== "string") ||
    (u.mode != null &&
      u.mode !== "mock" &&
      u.mode !== "deepseek" &&
      u.mode !== "openai") ||
    (u.cost_estimate_usd != null &&
      (typeof u.cost_estimate_usd !== "number" ||
        !Number.isFinite(u.cost_estimate_usd) ||
        u.cost_estimate_usd < 0)) ||
    (u.billing_complete !== undefined &&
      typeof u.billing_complete !== "boolean")
  )
    return false;
  return v.status === "running"
    ? v.result === null
    : isResult(v.result) &&
        v.status === v.result.status &&
        v.id === v.result.turn_id;
}
export function isStory(v: unknown): v is Story {
  if (
    !record(v) ||
    !strings(v, ["title", "subtitle", "adaptation_note", "wang_reply"]) ||
    !Array.isArray(v.acts) ||
    v.acts.length !== 5 ||
    !record(v.npcs) ||
    !Array.isArray(v.tips)
  )
    return false;
  const npcs = v.npcs;
  return (
    ["sun", "li", "zhang"].every(
      (key) =>
        record(npcs[key]) &&
        strings(npcs[key], ["name", "role", "portrait", "color", "greeting"]),
    ) &&
    v.tips.every((t) => record(t) && strings(t, ["title", "text", "source"])) &&
    v.acts.every(
      (a) =>
        record(a) &&
        strings(a, [
          "title",
          "chapter_title",
          "location",
          "time",
          "intro",
          "background",
        ]) &&
        Array.isArray(a.choices) &&
        a.choices.every(
          (c) =>
            record(c) &&
            typeof c.label === "string" &&
            isAction(c.action) &&
            (c.target == null || isNpc(c.target)),
        ) &&
        (a.interlude == null ||
          (record(a.interlude) &&
            strings(a.interlude, ["image", "location", "time", "text"]))),
    )
  );
}
