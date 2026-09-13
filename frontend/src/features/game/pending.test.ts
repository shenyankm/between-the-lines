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
  requestId: "11111111-1111-4111-8111-111111111111",
  replayed: false,
  payload: {
    request_id: "11111111-1111-4111-8111-111111111111",
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
    { request_id: "11111111-1111-4111-8111-111111111111", version: -1 },
    { request_id: "11111111-1111-4111-8111-111111111111", version: 1.5 },
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

it.each([
  { action: "invented" },
  { npc: "other" },
  { text: 5 },
  { text: "x".repeat(1501) },
  { secret: "value" },
])("never replays malformed stored payload %j", (invalid) => {
  sessionStorage.setItem(
    "pending:v1:u:s",
    JSON.stringify({
      format: 1,
      userId: "u",
      saveId: "s",
      requestId: "11111111-1111-4111-8111-111111111111",
      replayed: false,
      payload: {
        request_id: "11111111-1111-4111-8111-111111111111",
        version: 0,
        ...invalid,
      },
    }),
  );
  expect(readPending("u", "s")?.payload).toBeUndefined();
  expect(readPending("u", "s")?.requestId).toBe(
    "11111111-1111-4111-8111-111111111111",
  );
});

it("discards a damaged identity that could never have been accepted as a UUID", () => {
  writePending({
    ...record,
    requestId: "not-a-uuid",
    payload: { request_id: "not-a-uuid", version: 0 },
  });
  expect(readPending("u", "s")).toBeNull();
});
it("preserves proposal/card references but refuses malformed replay extensions", () => {
  const id = record.requestId;
  const payload = {
    ...record.payload,
    proposal_id: id,
    proposed_action: "leave",
    discussion_id: id,
    perspective_id: "0",
  };
  for (const overrides of [
    {},
    { proposal_id: 42 },
    { proposal_id: "bad" },
    { discussion_id: 42 },
    { discussion_id: "bad" },
    { perspective_id: 42 },
    { perspective_id: "x".repeat(41) },
    { proposed_action: "unknown" },
  ]) {
    resetPendingMemory();
    sessionStorage.setItem(
      "pending:v1:u:s",
      JSON.stringify({ ...record, payload: { ...payload, ...overrides } }),
    );
    expect(!!readPending("u", "s")?.payload).toBe(
      Object.keys(overrides).length === 0,
    );
  }
});
