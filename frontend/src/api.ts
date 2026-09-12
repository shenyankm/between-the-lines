import type { Action, Npc, Result } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      typeof data.detail === "string" ? data.detail : "请求未完成，请重试。",
      response.status,
    );
  }
  return response.json();
}

export function parseSSE(
  frame: string,
): { event: string; data: unknown } | null {
  const lines = frame.replace(/\r/g, "").split("\n");
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  return event && data ? { event, data: JSON.parse(data) } : null;
}

export async function sendTurn(
  saveId: string,
  version: number,
  npc: Npc,
  action: Action,
  text: string,
  requestId: string,
  onStatus: (message: string) => void,
): Promise<Result> {
  const response = await fetch(`/api/saves/${saveId}/turns`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, version, npc, action, text }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      typeof data.detail === "string" ? data.detail : "请求未完成。",
      response.status,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("浏览器无法读取回复。");
  const decoder = new TextDecoder();
  let buffer = "",
    result: Result | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = parseSSE(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (frame?.event === "status")
        onStatus((frame.data as { text: string }).text);
      if (frame?.event === "done") result = frame.data as Result;
    }
    if (done) break;
  }
  if (!result) throw new Error("连接中断，请恢复回合结果。");
  return result;
}
