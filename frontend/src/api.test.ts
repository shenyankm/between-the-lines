import { describe, expect, it } from "vitest";
import { parseSSE } from "./api";
describe("SSE parser", () => {
  it("parses Chinese text and ignores heartbeat frames", () => {
    expect(
      parseSSE('event: dialogue\ndata: {"text":"请说明材料要求"}'),
    ).toEqual({ event: "dialogue", data: { text: "请说明材料要求" } });
    expect(parseSSE(": heartbeat")).toBeNull();
  });
  it("handles CRLF and multi-line JSON", () => {
    expect(
      parseSSE('event: done\r\ndata: {"status":\r\ndata: "completed"}'),
    ).toEqual({ event: "done", data: { status: "completed" } });
  });
});
