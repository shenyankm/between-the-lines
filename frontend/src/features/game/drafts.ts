import type { Npc } from "../../types";
import { record } from "../../contracts";
export type Draft = {
  text: string;
  act: number;
  discussion_id?: string;
  perspective_id?: string;
};
const memory = new Map<string, Draft>();
const prefix = (user: string) => `draft:v2:${user}:`;
const key = (user: string, save: string, npc: Npc) =>
  `${prefix(user)}${save}:${npc}`;
export function readDraft(user: string, save: string, npc: Npc): Draft {
  const name = key(user, save, npc);
  if (memory.has(name)) return memory.get(name)!;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(name) || "null");
    if (
      record(value) &&
      typeof value.text === "string" &&
      value.text.length <= 1500 &&
      Number.isInteger(value.act)
    ) {
      const draft: Draft = { text: value.text, act: Number(value.act) };
      if (
        typeof value.discussion_id === "string" &&
        typeof value.perspective_id === "string"
      ) {
        draft.discussion_id = value.discussion_id;
        draft.perspective_id = value.perspective_id;
      }
      memory.set(name, draft);
      return draft;
    }
  } catch {
    /* Browser storage can be unavailable. */
  }
  return { text: "", act: 0 };
}
export function writeDraft(user: string, save: string, npc: Npc, draft: Draft) {
  const name = key(user, save, npc);
  memory.set(name, draft);
  try {
    sessionStorage.setItem(name, JSON.stringify(draft));
  } catch {
    /* Memory fallback. */
  }
}
export function clearIdentityDrafts(user: string) {
  for (const name of memory.keys())
    if (name.startsWith(prefix(user))) memory.delete(name);
  try {
    for (const name of Object.keys(sessionStorage))
      if (name.startsWith(prefix(user))) sessionStorage.removeItem(name);
  } catch {
    /* Memory already cleared. */
  }
}
