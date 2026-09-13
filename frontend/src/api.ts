import type {
  Action,
  Config,
  Npc,
  PlayState,
  Result,
  Save,
  Story,
  Turn,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Stable snake_case code from the envelope; safe to branch on, unlike prose. */
    public code?: string,
    /** The id the API logged for this request, echoed back in X-Request-Id. */
    public requestId?: string,
  ) {
    super(message);
  }
}

interface ErrorBody {
  code: string;
  message: string;
  request_id: string;
}

interface DescribedError {
  message: string;
  code?: string;
  requestId?: string;
}

/** Narrow an unknown payload to the API's error envelope, if it sent one. */
function describeError(payload: unknown, fallback: string): DescribedError {
  // Not just a missing envelope: an upstream nginx 502 answers with an HTML page,
  // whose JSON parse already failed and left `{}` here.
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload)
  ) {
    return { message: fallback };
  }
  const body: unknown = payload.error;
  if (typeof body !== "object" || body === null) return { message: fallback };
  const candidate = body as Partial<ErrorBody>;
  return {
    message:
      typeof candidate.message === "string" && candidate.message
        ? candidate.message
        : fallback,
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    ...(typeof candidate.request_id === "string"
      ? { requestId: candidate.request_id }
      : {}),
  };
}

export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => ({}));
    const described = describeError(data, "请求未完成，请重试。");
    throw new ApiError(
      described.message,
      response.status,
      described.code,
      described.requestId,
    );
  }
  // The HTTP boundary is untyped; callers declare the expected shape via T.
  const payload: unknown = await response.json();
  return payload as T;
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
  signal?: AbortSignal,
): Promise<Result> {
  const response = await fetch(`/api/saves/${saveId}/turns`, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, version, npc, action, text }),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => ({}));
    const described = describeError(data, "请求未完成。");
    throw new ApiError(
      described.message,
      response.status,
      described.code,
      described.requestId,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("浏览器无法读取回复。");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1024 * 1024)
        throw new Error("回复格式无效，请恢复回合结果。");
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = parseSSE(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (frame?.event === "status") {
          if (!record(frame.data) || typeof frame.data.text !== "string")
            throw new Error("回复格式无效，请恢复回合结果。");
          onStatus(frame.data.text);
        }
        if (frame?.event === "done") {
          if (!isResult(frame.data))
            throw new Error("回复格式无效，请恢复回合结果。");
          return frame.data;
        }
      }
      if (done) throw new Error("连接中断，请恢复回合结果。");
    }
  } finally {
    // A cancelled tee branch may wait for another consumer; a committed result must not wait on cleanup.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isResult(value: unknown): value is Result {
  if (
    !record(value) ||
    !["completed", "failed"].includes(String(value.status)) ||
    typeof value.turn_id !== "string" ||
    !record(value.save)
  )
    return false;
  const save = value.save,
    state = save.state;
  return (
    typeof save.id === "string" &&
    Number.isInteger(save.version) &&
    Number(save.version) >= 0 &&
    record(state) &&
    Number.isInteger(state.act) &&
    Number(state.act) >= 0 &&
    Number(state.act) <= 4 &&
    [state.credit, state.stress, state.heat].every(
      (n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100,
    ) &&
    Array.isArray(state.flags) &&
    state.flags.every((flag: unknown) => typeof flag === "string") &&
    ["pending", "approved"].includes(String(state.procurement)) &&
    (state.ending === null || typeof state.ending === "string") &&
    (value.text === undefined ||
      value.text === null ||
      typeof value.text === "string") &&
    (value.retryable === undefined || typeof value.retryable === "boolean")
  );
}

/** Concrete endpoint methods are the only HTTP interface used by features. */
export const gameApi = {
  config: (signal?: AbortSignal) => api<Config>("/config", undefined, signal),
  user: (signal?: AbortSignal) => api<User>("/auth/me", undefined, signal),
  login: () => api<User>("/auth/dev", { name: "试玩者" }),
  logout: () => api<{ ok: boolean }>("/auth/logout", {}),
  saves: (signal?: AbortSignal) => api<Save[]>("/saves", undefined, signal),
  createSave: () => api<Save>("/saves", {}),
  story: (signal?: AbortSignal) => api<Story>("/story", undefined, signal),
  playState: (id: string, signal?: AbortSignal) =>
    api<PlayState>(`/saves/${id}/play-state`, undefined, signal),
  turn: async (
    id: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<Turn> => {
    const turn = await api<Turn>(
      `/saves/${id}/turns/${requestId}`,
      undefined,
      signal,
    );
    if (
      !["running", "completed", "failed"].includes(turn.status) ||
      (turn.status !== "running" && !isResult(turn.result))
    )
      throw new Error("回复格式无效，请恢复回合结果。");
    return turn;
  },
};
