import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { save, story } from "../../testing/fixtures";
import { GameStage } from "./GameStage";

it("lets players reread the authored prologue without changing their game state", () => {
  const state = save({ state: { act: 0 } }).state;
  const before = structuredClone(state);
  const setPanel = vi.fn();
  render(
    <MemoryRouter>
      <GameStage
        story={{ ...story, story_version: 2 }}
        state={state}
        scene={story.acts[0]!}
        character={story.npcs.sun}
        npc="sun"
        setPanel={setPanel}
      />
    </MemoryRouter>,
  );
  expect(screen.getByAltText("周菱菱立绘")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "那句玩笑" }));
  expect(screen.getByAltText("孙淼立绘")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "我的感受" }));
  expect(screen.getByAltText("周菱菱立绘")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "我的身份" }));
  expect(state).toEqual(before);
  expect(setPanel).not.toHaveBeenCalled();
});
