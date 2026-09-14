import type { Npc } from "../../types";
import { record } from "../../contracts";
export type Draft = {
  text: string;
  act: number;
  discussion_id?: string;
  perspective_id?: string;
};
const memory = new Map<string, Draft>();
const formMemory = new Map<string, Record<string, string>>();
const prefix = (user: string) => `draft:v2:${user}:`;
const key = (user: string, save: string, npc: Npc, scope = "") =>
  `${prefix(user)}${save}:${npc}${scope ? `:${scope}` : ""}`;
export function readDraft(
  user: string,
  save: string,
  npc: Npc,
  scope = "",
): Draft {
  const name = key(user, save, npc, scope);
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
export function writeDraft(
  user: string,
  save: string,
  npc: Npc,
  draft: Draft,
  scope = "",
) {
  const name = key(user, save, npc, scope);
  memory.set(name, draft);
  try {
    sessionStorage.setItem(name, JSON.stringify(draft));
  } catch {
    /* Memory fallback. */
  }
}
export function clearIdentityDrafts(user: string) {
  for (const name of formMemory.keys())
    if (name.startsWith(prefix(user))) formMemory.delete(name);
  for (const name of memory.keys())
    if (name.startsWith(prefix(user))) memory.delete(name);
  try {
    for (const name of Object.keys(sessionStorage))
      if (name.startsWith(prefix(user))) sessionStorage.removeItem(name);
  } catch {
    /* Memory already cleared. */
  }
}

export function readFormDraft(user: string, save: string, form: string) {
  const name = `${prefix(user)}form:${save}:${form}`;
  if (formMemory.has(name)) return formMemory.get(name)!;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(name) || "null");
    if (
      record(value) &&
      Object.keys(value).length <= 10 &&
      Object.values(value).every(
        (v) => typeof v === "string" && v.length <= 1000,
      )
    ) {
      const fields = value as Record<string, string>;
      formMemory.set(name, fields);
      return fields;
    }
  } catch {
    /* The current page still keeps in-memory input. */
  }
  return null;
}
export function writeFormDraft(
  user: string,
  save: string,
  form: string,
  fields: Record<string, string>,
) {
  const name = `${prefix(user)}form:${save}:${form}`;
  formMemory.set(name, fields);
  try {
    sessionStorage.setItem(name, JSON.stringify(fields));
    return true;
  } catch {
    return false;
  }
}
