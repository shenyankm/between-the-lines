import { create } from "zustand";
import type { Npc } from "./types";
type Panel = "phone" | "work" | "tips" | "history" | null;
export const useUI = create<{
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
