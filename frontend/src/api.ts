import type { Action, Npc, Result } from "./types";
import {
  isConfig,
  isPlayState,
  isSave,
  isStory,
  isTurn,
  isUser,
  record,
} from "./contracts";
export { isResult } from "./contracts";
import { isResult } from "./contracts";
import type { components } from "./generated/api";

type ErrorBody = components["schemas"]["ErrorBody"];
export type ErrorKind = "http" | "network" | "timeout" | "protocol";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public requestId?: string,
    public retryAfterSeconds?: number,
    public kind: ErrorKind = "http",
    public details?: ErrorBody["details"],
    public recovery?: ErrorBody["recovery"],
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求未完成。";
}
export function retryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  const seconds = /^\d+$/.test(raw)
    ? Number(raw)
    : /[A-Za-z]/.test(raw)
      ? Math.ceil((Date.parse(raw) - now) / 1000)
      : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
export function protocolError(requestId?: string): ApiError {
  return new ApiError(
    "回复格式无效，请恢复回合结果。",
    0,
    "invalid_response",
    requestId,
    undefined,
    "protocol",
  );
}
async function responseError(response: Response): Promise<ApiError> {
  const payload: unknown = await response.json().catch(() => null);
  const body = record(payload) && record(payload.error) ? payload.error : {};
  const waitHeader = retryAfter(response.headers.get("Retry-After"));
  const waitBody =
    typeof body.retry_after_seconds === "number" &&
    Number.isSafeInteger(body.retry_after_seconds) &&
    body.retry_after_seconds >= 0
      ? body.retry_after_seconds
      : undefined;
  const details = Array.isArray(body.details)
    ? body.details.filter(
        (issue): issue is NonNullable<ErrorBody["details"]>[number] =>
          record(issue) &&
          typeof issue.field === "string" &&
          typeof issue.code === "string" &&
          typeof issue.message === "string",
      )
    : undefined;
  return new ApiError(
    typeof body.message === "string" && body.message
      ? body.message
      : "请求未完成，请重试。",
    response.status,
    typeof body.code === "string" ? body.code : undefined,
    typeof body.request_id === "string" && body.request_id
      ? body.request_id
      : (response.headers.get("X-Request-Id") ?? undefined),
    waitHeader === undefined ? waitBody : Math.max(waitHeader, waitBody ?? 0),
    "http",
    details,
    [
      "retry",
      "login",
      "refresh",
      "edit",
      "wait",
      "contact",
      "recover",
    ].includes(String(body.recovery))
      ? (body.recovery as ErrorBody["recovery"])
      : undefined,
  );
}
function normalise(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return signal.reason as Error;
  if (error instanceof ApiError || isCancelled(error)) return error as Error;
  return new ApiError(
    "网络连接失败，请检查网络后重试。",
    0,
    "network_error",
    undefined,
    undefined,
    "network",
  );
}
function subscription(signal: AbortSignal | undefined, milliseconds: number) {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new DOMException("请求已取消", "AbortError"));
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        controller.abort(
          new ApiError(
            "请求超时，请稍后恢复或重试。",
            0,
            "request_timeout",
            undefined,
            undefined,
            "timeout",
          ),
        ),
      milliseconds,
    );
  };
  reset();
  return {
    signal: controller.signal,
    reset,
    close: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    },
  };
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    // Observe work even on an already-cancelled call: fetch may reject too.
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("请求已取消", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  retry = true,
  guard?: (value: unknown) => value is T,
): Promise<T> {
  let waited = 0;
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const scope = subscription(signal, 15_000);
    try {
      const response = await abortable(
        fetch(`/api${path}`, {
          credentials: "same-origin",
          signal: scope.signal,
          ...(body === undefined
            ? {}
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
        }),
        scope.signal,
      );
      if (!response.ok)
        throw await abortable(responseError(response), scope.signal);
      try {
        const value: unknown = await abortable(response.json(), scope.signal);
        if (guard && !guard(value))
          throw protocolError(
            response.headers.get("X-Request-Id") ?? undefined,
          );
        return value as T;
      } catch (error) {
        if (scope.signal.aborted) throw error;
        if (error instanceof SyntaxError || error instanceof ApiError)
          throw protocolError(
            response.headers.get("X-Request-Id") ?? undefined,
          );
        const failure = normalise(error, scope.signal);
        if (failure instanceof ApiError)
          failure.requestId ??=
            response.headers.get("X-Request-Id") ?? undefined;
        throw failure;
      }
    } catch (error) {
      failure = normalise(error, scope.signal);
    } finally {
      scope.close();
    }
    const transient =
      failure instanceof ApiError &&
      (["network", "timeout"].includes(failure.kind) ||
        [502, 503, 504].includes(failure.status));
    if (body !== undefined || !retry || !transient) throw failure;
    if (attempt === 2) continue;
    const seconds = Math.max(
      attempt + 1,
      (failure as ApiError).retryAfterSeconds ?? 0,
    );
    if (waited + seconds > 15) throw failure;
    waited += seconds;
    await wait(seconds * 1000, signal);
  }
  throw failure;
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
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    throw protocolError();
  }
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
  extra: Partial<import("./types").TurnInput> = {},
): Promise<Result> {
  const scope = subscription(signal, 90_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let correlation: string | undefined;
  const read = async (): Promise<Result> => {
    const response = await abortable(
      fetch(`/api/saves/${encodeURIComponent(saveId)}/turns`, {
        method: "POST",
        credentials: "same-origin",
        signal: scope.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...extra,
          request_id: requestId,
          version,
          npc,
          action,
          text,
        }),
      }),
      scope.signal,
    );
    correlation = response.headers.get("X-Request-Id") ?? undefined;
    if (!response.ok)
      throw await abortable(responseError(response), scope.signal);
    if (!response.headers.get("Content-Type")?.includes("text/event-stream"))
      throw protocolError(correlation);
    reader = response.body?.getReader();
    if (!reader) throw protocolError(correlation);
    const decoder = new TextDecoder();
    let buffer = "";
    while (!scope.signal.aborted) {
      const { done, value } = await abortable(reader.read(), scope.signal);
      scope.reset();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1024 * 1024) throw protocolError(correlation);
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = parseSSE(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (frame?.event === "status") {
          if (!record(frame.data) || typeof frame.data.text !== "string")
            throw protocolError(correlation);
          onStatus(frame.data.text);
        }
        if (frame?.event === "error") {
          if (
            !record(frame.data) ||
            frame.data.code !== "subscription_failed" ||
            typeof frame.data.turn_id !== "string" ||
            typeof frame.data.request_id !== "string"
          )
            throw protocolError(correlation);
          throw new ApiError(
            "回复连接已中断，请恢复回合结果。",
            0,
            "subscription_failed",
            frame.data.request_id,
            undefined,
            "protocol",
            undefined,
            "recover",
          );
        }
        if (frame?.event === "done") {
          scope.signal.throwIfAborted();
          if (!isResult(frame.data)) throw protocolError(correlation);
          return frame.data;
        }
      }
      if (done)
        throw new ApiError(
          "连接中断，请恢复回合结果。",
          0,
          "stream_interrupted",
          correlation,
          undefined,
          "network",
          undefined,
          "recover",
        );
    }
    throw scope.signal.reason as Error;
  };
  try {
    return await read().catch((error: unknown) => {
      const failure = normalise(error, scope.signal);
      if (failure instanceof ApiError) failure.requestId ??= correlation;
      throw failure;
    });
  } finally {
    scope.close();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
async function checked<T>(
  path: string,
  guard: (value: unknown) => value is T,
  body?: unknown,
  signal?: AbortSignal,
  retry = true,
): Promise<T> {
  return api<T>(path, body, signal, retry, guard);
}
export const gameApi = {
  guest: () => checked("/auth/guest", isUser, {}),
  visit: (id: string) =>
    checked(`/saves/${encodeURIComponent(id)}/visit`, isSave, {}),
  config: (signal?: AbortSignal) =>
    checked("/config", isConfig, undefined, signal),
  user: (signal?: AbortSignal) =>
    checked("/auth/me", isUser, undefined, signal),
  login: () => checked("/auth/dev", isUser, { name: "试玩者" }),
  logout: () =>
    checked(
      "/auth/logout",
      (v): v is { ok: boolean } => record(v) && v.ok === true,
      {},
    ),
  saves: (signal?: AbortSignal) =>
    checked(
      "/saves",
      (v): v is import("./types").Save[] => Array.isArray(v) && v.every(isSave),
      undefined,
      signal,
    ),
  createSave: () => checked("/saves", isSave, {}),
  story: (signal?: AbortSignal, version = 1) =>
    checked(
      version === 1 ? "/story" : `/story?version=${version}`,
      isStory,
      undefined,
      signal,
    ),
  playState: (id: string, signal?: AbortSignal) =>
    checked(
      `/saves/${encodeURIComponent(id)}/play-state`,
      isPlayState,
      undefined,
      signal,
    ),
  // Recovery owns its own retry budget; never nest automatic GET retries here.
  turn: (id: string, requestId: string, signal?: AbortSignal) =>
    checked(
      `/saves/${encodeURIComponent(id)}/turns/${encodeURIComponent(requestId)}`,
      isTurn,
      undefined,
      signal,
      false,
    ),
};
