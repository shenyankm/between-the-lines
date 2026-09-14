import type { Page } from "@playwright/test";
import type { PlayState, Save, Story } from "../src/types";
function save({ id = "responsive-save" } = {}): Save {
  return {
    id,
    version: 2,
    read_only: false,
    story_id: "workplace-s1",
    story_version: 1,
    last_played_at: null,
    parent_save_id: null,
    deleted_at: null,
    scene_intro: "这次，你决定先把事情问清楚。",
    ending_summary: null,
    state: {
      act: 1,
      credit: 60,
      stress: 20,
      heat: 10,
      flags: [],
      procurement: "pending",
      ending: null,
    },
  };
}
import authored from "../src/testing/story-v3.json" with { type: "json" };
import legacy from "../src/testing/story.json" with { type: "json" };

/** All API traffic stays inside the browser, including visit/jobs/turn writes. */
export async function responsiveFixture(page: Page) {
  const sample: Save = {
    ...save({ id: "responsive-save" }),
    story_version: 3,
    state: {
      ...save().state,
      story_version: 3,
      content_revision: 2,
      node: "act_1",
      tick: 1,
      rumination: 32,
      pressure: 46,
      partner_choice: null,
      exit_draft: null,
      outcome: null,
      quiet_turns: 0,
    },
    relationships: ["孙淼", "李姐", "张工", "王会计"].map((name, i) => ({
      id: String(i),
      name,
      role: "同事",
      description: "关系变化以本局互动为依据。".repeat(15),
      evidence_event_ids: [],
    })),
  };
  const play: PlayState = {
    save: sample,
    events: [],
    active_turn: null,
    ai: { available: true, reason: null },
    performance_version: sample.version,
    performance: [
      {
        id: "line",
        speaker: "sun",
        text: "我只是觉得你可能不想参加，就替你说了。",
        portraits: [],
      },
    ],
    reading: { act_1: 1 },
    available_actions: [
      "boundary",
      "next",
      "submit_purchase",
      "supplement",
      "draft_exit",
      "draft_support",
    ].map((action) => ({
      action: action as NonNullable<
        PlayState["available_actions"]
      >[number]["action"],
      label: action === "boundary" ? "先问清楚，再表达自己的想法。" : action,
      enabled: true,
      completed: false,
      requires_confirmation: false,
      reason: "",
      effect: "",
      target: "sun",
    })),
  };
  const view = {
    play,
    story: structuredClone(authored) as Story,
    signed: true,
    count: 5,
    jobStatus: "completed",
    long: false,
    turns: 0,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json });
    if (path.endsWith("/auth/me")) {
      return view.signed
        ? reply({
            id: "responsive-user",
            name: "合成审查用户",
            identity_type: "dev",
            can_play: true,
          })
        : route.fulfill({
            status: 401,
            json: { error: { code: "not_authenticated", message: "请登录" } },
          });
    }
    if (path.endsWith("/config"))
      return reply({
        agent_mode: "mock",
        dev_login: true,
        guest_login: true,
        zhihu_login: false,
        model_ready: true,
      });
    if (path.endsWith("/story")) return reply(view.story);
    if (path.endsWith("/play-state")) return reply(view.play);
    if (path.endsWith("/saves"))
      return reply(
        Array.from({ length: view.count }, (_, i) => ({
          ...view.play.save,
          id: `responsive-${i}`,
        })),
      );
    if (path.endsWith("/visit")) return reply(view.play.save);
    if (path.endsWith("/reading")) return reply({ ok: true });
    if (path.endsWith("/events")) return reply(view.play.events);
    if (path.endsWith("/snapshots")) return reply([]);
    if (path.endsWith("/diagnostics")) return route.fulfill({ status: 204 });
    if (path.endsWith("/turns")) {
      view.turns++;
      return route.fulfill({
        status: 422,
        json: {
          error: {
            code: "rule_violation",
            message: "请补充具体的工作安排。",
            request_id: "responsive-fixture",
          },
        },
      });
    }
    if (path.endsWith("/jobs")) {
      if (route.request().method() === "GET") return reply([]);
      const { kind } = route.request().postDataJSON() as { kind: string };
      return reply({
        id: "fixture-job",
        kind,
        status: view.jobStatus,
        result:
          view.jobStatus !== "completed"
            ? null
            : kind === "ending"
              ? {
                  text:
                    "你为自己的选择留下了空间。".repeat(view.long ? 70 : 3) +
                    "\n\n事实与回顾分开呈现。",
                  interactions: [],
                }
              : {
                  label: "合成审查观点",
                  cards: [
                    {
                      id: "card",
                      view: "先核实，再回应",
                      situation: "情况尚不清楚时",
                      expression: "我想先确认具体安排。",
                      possible_cost: "需要额外沟通时间",
                      sources: [],
                    },
                  ],
                },
      });
    }
    throw new Error(
      `Unmocked responsive request: ${route.request().method()} ${path}`,
    );
  });
  return {
    view,
    async stage() {
      await page.goto("/play/responsive-save");
      await page
        .getByRole("textbox", { name: "自由表达", exact: true })
        .waitFor();
    },
    legacy() {
      view.story = legacy as Story;
      view.play.save = {
        ...save({ id: "responsive-save" }),
        relationships: sample.relationships,
      };
      view.play.performance = undefined;
      view.play.available_actions = undefined;
    },
  };
}
