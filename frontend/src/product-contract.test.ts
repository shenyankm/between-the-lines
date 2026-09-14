import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { gameApi } from "./api";
import { isPlayState } from "./contracts";
import { server } from "./testing/server";
import { save, story } from "./testing/fixtures";
import { imageSource, imageSet } from "./images";
const available = {
  action: "boundary",
  label: "边界",
  enabled: true,
  completed: false,
  requires_confirmation: false,
  target: "sun",
  effect: "登记",
  reason: "",
};
const proposal = {
  id: "p",
  action: "leave",
  version: 1,
  label: "离开",
  effect: "结束",
};
const view = {
  save: save(),
  events: [],
  active_turn: null,
  available_actions: [available],
  proposal,
  ai: { available: true, reason: null },
};
it("accepts extended play state and rejects malformed actions, proposals and AI status", () => {
  expect(isPlayState(view)).toBe(true);
  expect(
    isPlayState({
      ...view,
      available_actions: [{ ...available, target: null }],
      proposal: null,
      ai: { available: false, reason: null },
    }),
  ).toBe(true);
  for (const field of [
    "action",
    "label",
    "enabled",
    "completed",
    "requires_confirmation",
    "target",
    "effect",
    "reason",
  ])
    expect(
      isPlayState({
        ...view,
        available_actions: [{ ...available, [field]: 42 }],
      }),
    ).toBe(false);
  for (const field of ["id", "action", "version", "label", "effect"])
    expect(
      isPlayState({ ...view, proposal: { ...proposal, [field]: false } }),
    ).toBe(false);
  for (const ai of [[], { available: 1 }])
    expect(isPlayState({ ...view, ai })).toBe(false);
  expect(isPlayState({ ...view, available_actions: "bad" })).toBe(false);
});
it("guest creation and versioned story use validated public adapters", async () => {
  server.use(
    http.post("/api/auth/guest", () =>
      HttpResponse.json({
        id: "guest",
        name: "试玩者",
        identity_type: "guest",
        can_play: true,
      }),
    ),
    http.get("/api/story", ({ request }) => {
      expect(new URL(request.url).searchParams.get("version")).toBe("2");
      return HttpResponse.json(story);
    }),
  );
  expect((await gameApi.guest()).id).toBe("guest");
  expect((await gameApi.story(undefined, 2)).title).toBe(story.title);
});
it("responsive images choose a bounded variant and preserve unknown source fallback", () => {
  expect(imageSource("/assets/sun.png", 400)).toMatch(/sun-512-/);
  expect(imageSource("/assets/sun.png", 4000)).toMatch(/sun-1024-/);
  expect(imageSource("/assets/unknown.png")).toBe("/assets/unknown.png");
  expect(imageSet("/assets/sun.png")).toContain("256w");
  expect(imageSet("missing")).toBeUndefined();
});
