import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "zustand";
import { createUIStore } from "./store";
import type { Npc } from "./types";
const useUI = createUIStore();

beforeEach(() => {
  // The store is module-level state; reset it so tests cannot leak into each other.
  useUI.setState({ npc: "sun", panel: null });
});

describe("useUI", () => {
  it("starts on 孙淼 with every drawer closed", () => {
    expect(useUI.getState().npc).toBe("sun");
    expect(useUI.getState().panel).toBeNull();
  });

  it("selectNpc switches the interlocutor", () => {
    useUI.getState().selectNpc("zhang");
    expect(useUI.getState().npc).toBe("zhang");
  });

  it("opens each drawer by name and closes it again with null", () => {
    const panels = ["phone", "work", "tips", "history"] as const;
    for (const panel of panels) {
      useUI.getState().setPanel(panel);
      expect(useUI.getState().panel).toBe(panel);
    }
    useUI.getState().setPanel(null);
    expect(useUI.getState().panel).toBeNull();
  });

  it("notifies subscribers on every change until they unsubscribe", () => {
    const seen: Npc[] = [];
    const unsubscribe = useUI.subscribe((state) => {
      seen.push(state.npc);
    });

    useUI.getState().selectNpc("li");
    expect(seen).toEqual(["li"]);

    // zustand v5 subscribe has no selector: a panel change notifies too.
    useUI.getState().setPanel("tips");
    expect(seen).toEqual(["li", "li"]);

    unsubscribe();
    useUI.getState().selectNpc("zhang");
    expect(seen).toEqual(["li", "li"]);
  });

  it("re-renders a component that selects the current interlocutor", () => {
    const { result } = renderHook(() => useStore(useUI, (state) => state.npc));
    expect(result.current).toBe("sun");

    act(() => {
      useUI.getState().selectNpc("li");
    });
    expect(result.current).toBe("li");

    act(() => {
      useUI.getState().setPanel("phone");
    });
    // A primitive selector is not re-run into a new value, so the hook output
    // stays the interlocutor and nothing else.
    expect(result.current).toBe("li");
  });
});
