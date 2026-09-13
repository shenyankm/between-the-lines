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
        "replayed" in value &&
        typeof value.replayed === "boolean"
      ) {
        // Saved payloads are accepted only when their identity and shape match.
        const record = value as PendingTurn;
        if (
          record.payload &&
          (record.payload.request_id !== record.requestId ||
            !Number.isInteger(record.payload.version) ||
            record.payload.version < 0)
        )
          delete record.payload;
        memory.set(name, record);
        return record;
      }
    }
    const legacy = sessionStorage.getItem(`pending:${saveId}`);
    if (legacy)
      return { format: 1, userId, saveId, requestId: legacy, replayed: true };
  } catch {
    /* Browsers may deny storage; the server still owns the turn. */
  }
  return null;
}
export function writePending(record: PendingTurn): void {
  const name = key(record.userId, record.saveId);
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
