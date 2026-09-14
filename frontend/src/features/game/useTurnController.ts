import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, gameApi, sendTurn, errorMessage } from "../../api";
import type {
  Action,
  ErrorCode,
  Npc,
  PlayState,
  Result,
  Save,
  TurnInput,
} from "../../types";
import {
  clearPending,
  readPending,
  writePending,
  type PendingTurn,
} from "./pending";

export const playKey = (userId: string, saveId: string) =>
  ["play", userId, saveId] as const;
type Phase = "idle" | "submitting" | "waiting" | "recovering";
interface View {
  phase: Phase;
  pending: string | null;
  error: string;
  status: string;
  savedStatus?: string;
  savedEffects?: string[];
  issue?: unknown;
  blocked?: boolean;
}
const idle: View = { phase: "idle", pending: null, error: "", status: "" };
const completedStatus = "本回合已完成，进度已保存。";
const refreshingStatus = `${completedStatus}正在刷新页面…`;
const uncertainStatus = "请求是否受理尚未确认，正在查询原回合。";
const admissionErrors: ReadonlySet<string> = new Set<ErrorCode>([
  "not_authenticated",
  "zhihu_login_required",
  "forbidden_origin",
  "save_not_found",
  "request_id_reused",
  "save_busy",
  "version_conflict",
  "unsupported_save_version",
  "json_required",
  "validation_failed",
  "request_body_invalid",
  "empty_message",
  "rule_violation",
  "concurrency_budget_exhausted",
  "model_unconfigured",
]);
function rejected(error: unknown): boolean {
  // A proxy's status alone cannot prove that the API rejected the original turn.
  return error instanceof ApiError && admissionErrors.has(error.code ?? "");
}

export function useTurnController(
  userId: string,
  saveId: string,
  activeRequest?: string | null,
  onCompleted?: (input: Partial<TurnInput>) => void,
) {
  const client = useQueryClient();
  const [aiBlocked, setAiBlocked] = useState(false);
  const [view, setView] = useState<View>(idle);
  const record = useRef<PendingTurn | null>(null);
  const lifetime = useRef(new AbortController());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const checking = useRef(false);
  const since = useRef(0),
    attempt = useRef(0);
  const paused = useRef(false);
  const notBefore = useRef(0);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const remember = useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      if (error.status === 401 || error.recovery === "login") {
        paused.current = true;
        void client.invalidateQueries({ queryKey: ["user"] });
      }
      if (error.code === "model_unconfigured") {
        setAiBlocked(true);
        return;
      }
      if (error.retryAfterSeconds !== undefined) {
        notBefore.current = Math.max(
          notBefore.current,
          Date.now() + error.retryAfterSeconds * 1000,
        );
        clearTimeout(cooldownTimer.current);
        const expire = () => {
          const remaining = notBefore.current - Date.now();
          if (remaining > 0) {
            cooldownTimer.current = setTimeout(
              expire,
              Math.min(remaining, 60_000),
            );
            return;
          }
          if (!lifetime.current.signal.aborted)
            setView((v) => ({ ...v, blocked: paused.current }));
        };
        cooldownTimer.current = setTimeout(
          expire,
          Math.min(Math.max(0, notBefore.current - Date.now()), 60_000),
        );
      }
    },
    [client],
  );
  const settled = useRef(new Set<string>());
  const refresh = useCallback(
    async (signal = lifetime.current.signal) => {
      if (signal.aborted || paused.current || Date.now() < notBefore.current)
        return;
      const results = await Promise.allSettled([
        client.invalidateQueries(
          { queryKey: playKey(userId, saveId) },
          { throwOnError: true },
        ),
        client.invalidateQueries(
          { queryKey: ["saves", userId] },
          { throwOnError: true },
        ),
      ]);
      const failure = results.find((result) => result.status === "rejected");
      if (!signal.aborted && failure?.status === "rejected") {
        remember(failure.reason);
        setView((v) => ({
          ...v,
          issue: failure.reason,
          error: "进度刷新未完成，请重新加载。",
          savedStatus:
            v.savedStatus === refreshingStatus
              ? `${completedStatus}页面刷新未完成，可重新加载。`
              : v.savedStatus,
          blocked: paused.current || Date.now() < notBefore.current,
        }));
      } else if (!signal.aborted) {
        setView((v) =>
          v.savedStatus === refreshingStatus
            ? { ...v, savedStatus: completedStatus }
            : v,
        );
      }
    },
    [client, userId, saveId, remember],
  );

  const resolve = useCallback(
    (result: Result, signal: AbortSignal) => {
      if (signal.aborted) return;
      if (result.save.id !== saveId)
        throw new Error("回复与存档不匹配，请恢复回合结果。");
      if (result.status === "completed" && record.current?.payload)
        onCompleted?.(record.current.payload);
      if (record.current) settled.current.add(record.current.requestId);
      clearPending(userId, saveId);
      record.current = null;
      clearTimeout(timer.current);
      client.setQueryData<PlayState>(playKey(userId, saveId), (old) =>
        old
          ? {
              ...old,
              save:
                result.save.version >= old.save.version
                  ? result.save
                  : old.save,
              active_turn: null,
            }
          : old,
      );
      setView({
        ...idle,
        savedStatus:
          result.status === "completed"
            ? refreshingStatus
            : result.effects?.length
              ? "行动已保存，角色回复未完成。已保存的结果仍然有效，无需重复执行。"
              : "角色回复未完成，请查看已保存记录后继续。",
        savedEffects: (result.effects ?? []).flatMap((effect) =>
          typeof effect.text === "string" && effect.text ? [effect.text] : [],
        ),
        issue: result.failure
          ? new ApiError(
              result.failure.message,
              0,
              result.failure.code,
              result.failure.request_id ?? undefined,
              undefined,
              "http",
              undefined,
              "refresh",
            )
          : undefined,
        error:
          result.status === "failed"
            ? result.failure?.message ||
              result.text ||
              "回合未完成，请刷新后继续。"
            : "",
      });
    },
    [client, userId, saveId, onCompleted],
  );

  const recoverRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback(() => {
    if (!record.current || lifetime.current.signal.aborted || paused.current)
      return;
    if (Date.now() - since.current >= 90_000) {
      setView((v) => ({ ...v, phase: "waiting", status: "" }));
      return;
    }
    const delay = Math.max(
      [1000, 2000, 4000, 5000][Math.min(attempt.current++, 3)] ?? 5000,
      notBefore.current - Date.now(),
    );
    if (Date.now() - since.current + delay > 90_000) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void recoverRef.current();
    }, delay);
  }, []);

  const recover = useCallback(async () => {
    const current = record.current,
      signal = lifetime.current.signal;
    if (
      !current ||
      signal.aborted ||
      checking.current ||
      paused.current ||
      Date.now() < notBefore.current
    )
      return;
    checking.current = true;
    setView((v) => ({
      ...v,
      phase: "recovering",
      issue: undefined,
      error: "",
      status: "正在恢复回合…",
      savedStatus: v.savedStatus || uncertainStatus,
    }));
    try {
      const turn = await gameApi.turn(saveId, current.requestId, signal);
      if (signal.aborted) return;
      if (turn.result && turn.status !== "running")
        resolve(turn.result, signal);
      else
        setView((v) => ({
          ...v,
          phase: "waiting",
          error: "这一回合仍在处理，请稍后恢复。",
          savedStatus: "请求已受理，回合仍在处理，具体行动结果尚待确认。",
          status: "",
        }));
    } catch (error) {
      if (signal.aborted) return;
      remember(error);
      if (
        error instanceof ApiError &&
        error.status === 404 &&
        error.code === "turn_not_found" &&
        current.payload &&
        !current.replayed
      ) {
        const replay = { ...current, replayed: true };
        record.current = replay;
        writePending(replay);
        const p = current.payload;
        try {
          const result = await sendTurn(
            saveId,
            p.version,
            p.npc ?? "sun",
            p.action ?? "speak",
            p.text ?? "",
            p.request_id,
            (message) => {
              if (!signal.aborted) setView((v) => ({ ...v, status: message }));
            },
            signal,
            p,
          );
          resolve(result, signal);
        } catch (replayError) {
          if (!signal.aborted) {
            remember(replayError);
            if (rejected(replayError)) {
              clearPending(userId, saveId);
              record.current = null;
            }
            setView((v) => ({
              ...v,
              phase: record.current ? "waiting" : "idle",
              issue: replayError,
              blocked: paused.current || Date.now() < notBefore.current,
              status: "",
              pending: record.current?.requestId ?? null,
              savedStatus: record.current
                ? uncertainStatus
                : "请求未被受理，输入仍保留。",
              error:
                replayError instanceof Error
                  ? replayError.message
                  : "请求未完成。",
            }));
          }
        }
      } else {
        // Legacy records carry no payload. A confirmed missing turn can be cleared.
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          error.code === "turn_not_found" &&
          !current.payload
        ) {
          clearPending(userId, saveId);
          record.current = null;
        }
        setView((v) => ({
          ...v,
          phase: record.current ? "waiting" : "idle",
          pending: record.current?.requestId ?? null,
          savedStatus: record.current
            ? v.savedStatus || uncertainStatus
            : "未找到原回合，请查看当前进度后继续。",
          error: errorMessage(error),
          issue: error,
          blocked: paused.current || Date.now() < notBefore.current,
          status: "",
        }));
      }
    } finally {
      if (!signal.aborted) {
        checking.current = false;
        await refresh(signal);
        if (!signal.aborted) schedule();
      }
    }
  }, [refresh, resolve, saveId, schedule, userId, remember]);

  useEffect(() => {
    recoverRef.current = recover;
  }, [recover]);
  useEffect(() => {
    lifetime.current = new AbortController();
    checking.current = false;
    paused.current = false;
    notBefore.current = 0;
    settled.current.clear();
    record.current = readPending(userId, saveId);
    setView({ ...idle, pending: record.current?.requestId ?? null });
    since.current = Date.now();
    attempt.current = 0;
    if (record.current)
      timer.current = setTimeout(() => {
        void recoverRef.current();
      }, 0);
    return () => {
      lifetime.current.abort();
      clearTimeout(timer.current);
      clearTimeout(cooldownTimer.current);
    };
  }, [userId, saveId]);

  useEffect(() => {
    if (
      activeRequest &&
      !record.current &&
      !settled.current.has(activeRequest)
    ) {
      record.current = {
        format: 1,
        userId,
        saveId,
        requestId: activeRequest,
        replayed: true,
      };
      writePending(record.current);
      since.current = Date.now();
      attempt.current = 0;
      setView((v) => ({ ...v, pending: activeRequest }));
      timer.current = setTimeout(() => {
        void recoverRef.current();
      }, 0);
    }
  }, [activeRequest, userId, saveId]);
  useEffect(() => {
    const online = () => {
      since.current = Date.now();
      attempt.current = 0;
      void recoverRef.current();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);

  const submit = useCallback(
    async (
      save: Save,
      action: Action,
      text: string,
      npc: Npc,
      extra: Partial<TurnInput> = {},
    ): Promise<boolean> => {
      if (
        record.current ||
        lifetime.current.signal.aborted ||
        paused.current ||
        Date.now() < notBefore.current
      )
        return false;
      const signal = lifetime.current.signal;
      const requestId = crypto.randomUUID();
      const pending: PendingTurn = {
        format: 1,
        userId,
        saveId,
        requestId,
        replayed: false,
        payload: {
          ...extra,
          request_id: requestId,
          version: save.version,
          npc,
          action,
          text,
        },
      };
      record.current = pending;
      writePending(pending);
      since.current = Date.now();
      attempt.current = 0;
      setView({
        phase: "submitting",
        pending: requestId,
        error: "",
        status: "正在提交…",
        savedStatus: "正在提交，请求是否受理尚未确认。",
      });
      try {
        const result = await sendTurn(
          saveId,
          save.version,
          npc,
          action,
          text,
          requestId,
          (message) => {
            if (!signal.aborted) setView((v) => ({ ...v, status: message }));
          },
          signal,
          extra,
        );
        resolve(result, signal);
        await refresh(signal);
        return !signal.aborted && result.status === "completed";
      } catch (error) {
        if (signal.aborted) return false;
        remember(error);
        if (rejected(error)) {
          clearPending(userId, saveId);
          record.current = null;
        }
        setView({
          phase: record.current ? "waiting" : "idle",
          pending: record.current?.requestId ?? null,
          error: errorMessage(error),
          issue: error,
          blocked: paused.current || Date.now() < notBefore.current,
          status: "",
          savedStatus: record.current
            ? uncertainStatus
            : "请求未被受理，输入仍保留。",
        });
        // The recovery window begins after the subscription ends, even if the
        // original stream used its entire idle timeout.
        since.current = Date.now();
        attempt.current = 0;
        await refresh(signal);
        if (!signal.aborted) schedule();
        return false;
      }
    },
    [refresh, resolve, saveId, schedule, userId, remember],
  );

  const manualRecover = useCallback(async () => {
    clearTimeout(timer.current);
    since.current = Date.now();
    attempt.current = 0;
    await recover();
  }, [recover]);
  return {
    ...view,
    aiBlocked,
    blocked: view.blocked || paused.current || Date.now() < notBefore.current,
    busy: view.phase === "submitting" || view.phase === "recovering",
    submit,
    recover: manualRecover,
  };
}
