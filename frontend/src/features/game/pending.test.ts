import { describe, expect, it, vi, afterEach } from "vitest";
import {
  clearPending,
  readPending,
  resetPendingMemory,
  writePending,
  type PendingTurn,
} from "./pending";
const record: PendingTurn = {
  format: 1,
  userId: "u",
  saveId: "s",
  requestId: "request",
  replayed: false,
  payload: {
    request_id: "request",
    version: 3,
    action: "speak",
    npc: "li",
    text: "原始内容",
  },
};
afterEach(() => vi.restoreAllMocks());
describe("durable pending identity", () => {
  it("round trips the original payload and isolates both owner and save", () => {
    writePending(record);
    resetPendingMemory();
    expect(readPending("u", "s")).toEqual(record);
    expect(readPending("other", "s")).toBeNull();
    expect(readPending("u", "other")).toBeNull();
    clearPending("u", "s");
    expect(readPending("u", "s")).toBeNull();
    resetPendingMemory();
    expect(readPending("u", "s")).toBeNull();
  });
  it.each([
    "{broken",
    "null",
    "[]",
    '"text"',
    "{}",
    JSON.stringify({ ...record, format: 2 }),
    JSON.stringify({ ...record, userId: "other" }),
    JSON.stringify({ ...record, saveId: "other" }),
    JSON.stringify({ ...record, requestId: 4 }),
    JSON.stringify({ ...record, replayed: "yes" }),
  ])("rejects damaged or foreign storage %s", (raw) => {
    sessionStorage.setItem("pending:v1:u:s", raw);
    expect(readPending("u", "s")).toBeNull();
  });
  it.each([
    { request_id: "other", version: 3 },
    { request_id: "request", version: -1 },
    { request_id: "request", version: 1.5 },
  ])("never replays damaged payload %j", (payload) => {
    sessionStorage.setItem(
      "pending:v1:u:s",
      JSON.stringify({ ...record, payload }),
    );
    expect(readPending("u", "s")?.payload).toBeUndefined();
  });
  it("retains an in-memory request when storage reads, writes and removes are denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readPending("u", "s")).toBeNull();
    writePending(record);
    expect(readPending("u", "s")).toEqual(record);
    clearPending("u", "s");
    expect(readPending("u", "s")).toBeNull();
  });
});
