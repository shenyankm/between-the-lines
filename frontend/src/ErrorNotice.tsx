import { Button, Surface } from "@heroui/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, errorMessage, isCancelled } from "./api";
import s from "./App.module.css";

/** An action stays local to the failing operation; diagnostic copying is optional. */
export function ErrorNotice({
  error,
  onRetry,
  retryLabel = "重新加载",
  message,
  disabled = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  message?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState("");
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const duration =
      error instanceof ApiError ? (error.retryAfterSeconds ?? 0) : 0;
    const deadline = Date.now() + duration * 1000;
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    if (!duration) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [error]);
  if ((!error && !message) || isCancelled(error)) return null;
  const apiError = error instanceof ApiError ? error : undefined;
  const login = apiError?.status === 401 || apiError?.recovery === "login";
  const advice = login
    ? "请重新登录后继续。"
    : apiError?.recovery === "contact"
      ? "请联系管理员处理。"
      : apiError?.recovery === "edit"
        ? "请检查输入或选择其他行动。"
        : apiError?.recovery === "recover"
          ? "先查询原回合结果，避免重复操作。"
          : apiError?.recovery === "refresh"
            ? "刷新进度后再继续，已保存的行动不会丢失。"
            : "请稍后重试。";
  const diagnostic = [
    apiError?.code && `错误码：${apiError.code}`,
    apiError?.requestId && `请求编号：${apiError.requestId}`,
  ]
    .filter(Boolean)
    .join("\n");
  async function copy() {
    try {
      await navigator.clipboard.writeText(diagnostic);
      setCopied("已复制");
    } catch {
      setCopied("复制失败，请手动选择上方信息。");
    }
  }
  return (
    <Surface role="alert" className={s.error}>
      <p>{message || errorMessage(error)}</p>
      <p>{seconds > 0 ? `请等待 ${seconds} 秒后再试。` : advice}</p>
      {apiError?.details?.map((issue, index) => (
        <p key={index}>
          {issue.field}：{issue.message}
        </p>
      ))}
      {login ? (
        <Link to="/">返回首页登录</Link>
      ) : (
        onRetry && (
          <Button
            variant="secondary"
            isDisabled={disabled || seconds > 0}
            onClick={onRetry}
          >
            {retryLabel}
          </Button>
        )
      )}
      {diagnostic && (
        <details>
          <summary>错误详情</summary>
          <pre>{diagnostic}</pre>
          <Button variant="secondary" onClick={() => void copy()}>
            复制错误信息
          </Button>
          <span>{copied}</span>
        </details>
      )}
    </Surface>
  );
}
