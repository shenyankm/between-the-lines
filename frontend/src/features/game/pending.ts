import { isAction, isNpc, record } from "../../contracts";
import type { TurnInput } from "../../types";
export interface PendingTurn {
  format: 1;
  userId: string;
  saveId: string;
  requestId: string;
  payload?: Pick<TurnInput, "request_id" | "version"> &
    Partial<Omit<TurnInput, "request_id" | "version">>;
  replayed: boolean;
}
const memory = new Map<string, PendingTurn | null>();
const key = (userId: string, saveId: string) =>
  `pending:v1:${userId}:${saveId}`;
const validId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validPayload(value: unknown, requestId: string): boolean {
  if (!record(value)) return false;
  return (
    validId(requestId) &&
    value.request_id === requestId &&
    Number.isSafeInteger(value.version) &&
    Number(value.version) >= 0 &&
    (value.action === undefined || isAction(value.action)) &&
    (value.npc === undefined || isNpc(value.npc)) &&
    (value.text === undefined ||
      (typeof value.text === "string" && [...value.text].length <= 1500)) &&
    (value.proposed_action == null || isAction(value.proposed_action)) &&
    (value.proposal_id == null ||
      (typeof value.proposal_id === "string" && validId(value.proposal_id))) &&
    (value.discussion_id == null ||
      (typeof value.discussion_id === "string" &&
        validId(value.discussion_id))) &&
    (value.perspective_id == null ||
      (typeof value.perspective_id === "string" &&
        value.perspective_id.length <= 40)) &&
    Object.keys(value).every((key) =>
      [
        "request_id",
        "version",
        "action",
        "npc",
        "text",
        "proposed_action",
        "proposal_id",
        "discussion_id",
        "perspective_id",
        "channel",
        "target",
        "params",
      ].includes(key),
    )
  );
}
export function readPending(
  userId: string,
  saveId: string,
): PendingTurn | null {
  const name = key(userId, saveId);
  if (memory.has(name)) return memory.get(name) ?? null;
  try {
    const raw = sessionStorage.getItem(name);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (
        typeof value === "object" &&
        value !== null &&
        "format" in value &&
        value.format === 1 &&
        "userId" in value &&
        value.userId === userId &&
        "saveId" in value &&
        value.saveId === saveId &&
        "requestId" in value &&
        typeof value.requestId === "string" &&
        validId(value.requestId) &&
        "replayed" in value &&
        typeof value.replayed === "boolean"
      ) {
        // Saved payloads are accepted only when their identity and shape match.
        const record = value as PendingTurn;
        if (
          record.payload &&
          (!validPayload(record.payload, record.requestId) ||
            !Number.isInteger(record.payload.version) ||
            record.payload.version < 0)
        )
          delete record.payload;
        memory.set(name, record);
        return record;
      }
    }
    const legacy = sessionStorage.getItem(`pending:${saveId}`);
    if (legacy && validId(legacy))
      return { format: 1, userId, saveId, requestId: legacy, replayed: true };
  } catch {
    /* Browsers may deny storage; the server still owns the turn. */
  }
  return null;
}
export function writePending(record: PendingTurn): void {
  if (!validId(record.requestId)) {
    clearPending(record.userId, record.saveId);
    return;
  }
  const name = key(record.userId, record.saveId);
  if (record.payload && !validPayload(record.payload, record.requestId)) {
    record = { ...record };
    delete record.payload;
  }
  memory.set(name, record);
  try {
    sessionStorage.setItem(name, JSON.stringify(record));
  } catch {
    /* Memory fallback. */
  }
}
export function clearPending(userId: string, saveId: string): void {
  memory.set(key(userId, saveId), null);
  try {
    sessionStorage.removeItem(key(userId, saveId));
    sessionStorage.removeItem(`pending:${saveId}`);
  } catch {
    /* The memory tombstone prevents reuse in this page. */
  }
}
export function resetPendingMemory(): void {
  memory.clear();
}
