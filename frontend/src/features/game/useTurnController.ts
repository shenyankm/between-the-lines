import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, gameApi, sendTurn } from "../../api";
import type { Action, Npc, PlayState, Result, Save } from "../../types";
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
  liveReply?: { npc: Npc; text: string };
}
const idle: View = { phase: "idle", pending: null, error: "", status: "" };
const admissionErrors = new Set([
  "not_authenticated",
  "forbidden_origin",
  "save_not_found",
  "request_id_reused",
  "save_busy",
  "version_conflict",
  "unsupported_save_version",
  "json_required",
  "validation_failed",
  "empty_message",
  "rule_violation",
  "daily_limit_reached",
  "concurrency_budget_exhausted",
  "model_unconfigured",
  "monthly_cost_cap_reached",
]);
function rejected(error: unknown): boolean {
  // A proxy's status alone cannot prove that the API rejected the original turn.
  return error instanceof ApiError && admissionErrors.has(error.code ?? "");
}

export function useTurnController(
  userId: string,
  saveId: string,
  activeRequest?: string | null,
) {
  const client = useQueryClient();
  const [view, setView] = useState<View>(idle);
  const record = useRef<PendingTurn | null>(null);
  const lifetime = useRef(new AbortController());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const checking = useRef(false);
  const since = useRef(0),
    attempt = useRef(0);
  const settled = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    if (lifetime.current.signal.aborted) return;
    await Promise.all([
      client.invalidateQueries({ queryKey: playKey(userId, saveId) }),
      client.invalidateQueries({ queryKey: ["saves"] }),
    ]);
  }, [client, userId, saveId]);

  const resolve = useCallback(
    async (result: Result, signal: AbortSignal) => {
      if (signal.aborted) return;
      if (result.save.id !== saveId)
        throw new Error("回复与存档不匹配，请恢复回合结果。");
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
        error:
          result.status === "failed"
            ? result.text || "回合未完成，请刷新后继续。"
            : "",
      });
      await refresh();
    },
    [client, refresh, userId, saveId],
  );

  const recoverRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback(() => {
    if (!record.current || lifetime.current.signal.aborted) return;
    if (Date.now() - since.current >= 90_000) {
      setView((v) => ({ ...v, phase: "waiting", status: "" }));
      return;
    }
    const delay =
      [1000, 2000, 4000, 5000][Math.min(attempt.current++, 3)] ?? 5000;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void recoverRef.current();
    }, delay);
  }, []);

  const recover = useCallback(async () => {
    const current = record.current,
      signal = lifetime.current.signal;
    if (!current || signal.aborted || checking.current) return;
    checking.current = true;
    setView((v) => ({
      ...v,
      phase: "recovering",
      error: "",
      status: "正在恢复回合…",
    }));
    try {
      const turn = await gameApi.turn(saveId, current.requestId, signal);
      if (signal.aborted) return;
      if (turn.result && turn.status !== "running")
        await resolve(turn.result, signal);
      else
        setView((v) => ({
          ...v,
          phase: "waiting",
          error: "这一回合仍在处理，请稍后恢复。",
          status: "",
        }));
    } catch (error) {
      if (signal.aborted) return;
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
            (npc, text) => {
              if (!signal.aborted)
                setView((v) => ({ ...v, liveReply: { npc, text } }));
            },
          );
          await resolve(result, signal);
        } catch (replayError) {
          if (!signal.aborted) {
            if (rejected(replayError)) {
              clearPending(userId, saveId);
              record.current = null;
            }
            setView((v) => ({
              ...v,
              phase: "waiting",
              pending: record.current?.requestId ?? null,
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
          !current.payload
        ) {
          clearPending(userId, saveId);
          record.current = null;
        }
        setView((v) => ({
          ...v,
          phase: record.current ? "waiting" : "idle",
          pending: record.current?.requestId ?? null,
          error: error instanceof Error ? error.message : "请求未完成。",
          status: "",
        }));
      }
    } finally {
      if (!signal.aborted) {
        checking.current = false;
        await refresh();
        schedule();
      }
    }
  }, [refresh, resolve, saveId, schedule, userId]);

  useEffect(() => {
    recoverRef.current = recover;
  }, [recover]);
  useEffect(() => {
    lifetime.current = new AbortController();
    checking.current = false;
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
    ): Promise<boolean> => {
      if (record.current || lifetime.current.signal.aborted) return false;
      const signal = lifetime.current.signal;
      const requestId = crypto.randomUUID();
      const pending: PendingTurn = {
        format: 1,
        userId,
        saveId,
        requestId,
        replayed: false,
        payload: {
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
          (npc, text) => {
            if (!signal.aborted)
              setView((v) => ({ ...v, liveReply: { npc, text } }));
          },
        );
        await resolve(result, signal);
        return !signal.aborted && result.status === "completed";
      } catch (error) {
        if (signal.aborted) return false;
        if (rejected(error)) {
          clearPending(userId, saveId);
          record.current = null;
        }
        setView({
          phase: record.current ? "waiting" : "idle",
          pending: record.current?.requestId ?? null,
          error: error instanceof Error ? error.message : "请求未完成。",
          status: "",
        });
        await refresh();
        schedule();
        return false;
      }
    },
    [refresh, resolve, saveId, schedule, userId],
  );

  const manualRecover = useCallback(async () => {
    clearTimeout(timer.current);
    since.current = Date.now();
    attempt.current = 0;
    await recover();
  }, [recover]);
  return {
    ...view,
    busy: view.phase === "submitting" || view.phase === "recovering",
    submit,
    recover: manualRecover,
  };
}
