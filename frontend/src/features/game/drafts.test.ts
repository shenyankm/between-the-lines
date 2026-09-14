import { afterEach, expect, it, vi } from "vitest";
import { clearIdentityDrafts, readDraft, writeDraft } from "./drafts";
afterEach(() => {
  clearIdentityDrafts("alice");
  clearIdentityDrafts("bob");
  vi.restoreAllMocks();
});
it("isolates identities, saves and NPCs and keeps previous-act provenance", () => {
  writeDraft("alice", "one", "sun", { text: "旧幕草稿", act: 1 });
  writeDraft("alice", "two", "sun", { text: "另一档", act: 2 });
  writeDraft("bob", "one", "sun", { text: "他人草稿", act: 3 });
  expect(readDraft("alice", "one", "li").text).toBe("");
  expect(readDraft("alice", "one", "sun")).toEqual({
    text: "旧幕草稿",
    act: 1,
  });
  clearIdentityDrafts("alice");
  expect(readDraft("alice", "two", "sun").text).toBe("");
  expect(readDraft("bob", "one", "sun").text).toBe("他人草稿");
});
it("reloads persisted references and rejects corrupt storage", () => {
  sessionStorage.setItem(
    "draft:v2:alice:one:sun",
    JSON.stringify({
      text: "建议",
      act: 2,
      discussion_id: "card-job",
      perspective_id: "card",
    }),
  );
  expect(readDraft("alice", "one", "sun").discussion_id).toBe("card-job");
  sessionStorage.setItem(
    "draft:v2:alice:two:li",
    JSON.stringify({ text: "普通草稿", act: 1 }),
  );
  expect(readDraft("alice", "two", "li").text).toBe("普通草稿");
  sessionStorage.setItem("draft:v2:alice:three:zhang", "broken");
  expect(readDraft("alice", "three", "zhang").text).toBe("");
  sessionStorage.setItem(
    "draft:v2:alice:four:li",
    JSON.stringify({ text: 42, act: "2" }),
  );
  expect(readDraft("alice", "four", "li").text).toBe("");
});
it("remains editable and can log out when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readDraft("alice", "one", "sun").text).toBe("");
  writeDraft("alice", "one", "sun", { text: "内存草稿", act: 1 });
  expect(readDraft("alice", "one", "sun").text).toBe("内存草稿");
  clearIdentityDrafts("alice");
  expect(readDraft("alice", "one", "sun").text).toBe("");
});
it("logout clears memory even if persisted-key deletion fails", () => {
  writeDraft("alice", "one", "sun", { text: "待清除", act: 1 });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(() => clearIdentityDrafts("alice")).not.toThrow();
});

it("isolates form drafts by identity, save and type and removes them on logout", async () => {
  const { readFormDraft, writeFormDraft, clearIdentityDrafts } = await import(
    "./drafts"
  );
  writeFormDraft("form-user", "save-a", "support:leave", {
    reason: "休息",
    plan: "交接",
  });
  expect(readFormDraft("form-user", "save-a", "support:leave")).toEqual({
    reason: "休息",
    plan: "交接",
  });
  expect(readFormDraft("other-user", "save-a", "support:leave")).toBeNull();
  expect(readFormDraft("form-user", "save-b", "support:leave")).toBeNull();
  expect(readFormDraft("form-user", "save-a", "support:help")).toBeNull();
  clearIdentityDrafts("form-user");
  expect(readFormDraft("form-user", "save-a", "support:leave")).toBeNull();
});

it("keeps form input in memory when session storage fails, and rejects malformed storage", async () => {
  const { readFormDraft, writeFormDraft, clearIdentityDrafts } = await import(
    "./drafts"
  );
  sessionStorage.setItem(
    "draft:v2:malformed:form:s:exit",
    JSON.stringify({ reason: 123 }),
  );
  expect(readFormDraft("malformed", "s", "exit")).toBeNull();
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(writeFormDraft("fallback-form", "s", "exit", { reason: "保留" })).toBe(
    false,
  );
  expect(readFormDraft("fallback-form", "s", "exit")).toEqual({
    reason: "保留",
  });
  clearIdentityDrafts("fallback-form");
  fail.mockRestore();
});
