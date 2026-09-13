import { useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Npc } from "./types";
export type Panel = "phone" | "work" | "tips" | "history" | null;
export const createUIStore = () =>
  createStore<{
    npc: Npc;
    panel: Panel;
    selectNpc: (npc: Npc) => void;
    setPanel: (panel: Panel) => void;
  }>((set) => ({
    npc: "sun",
    panel: null,
    selectNpc: (npc) => set({ npc }),
    setPanel: (panel) => set({ panel }),
  }));

export function useUI() {
  const [store] = useState(createUIStore);
  return useStore(store);
}
