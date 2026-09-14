import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../api";
import { ErrorNotice } from "../ErrorNotice";
import type { User } from "../types";
import s from "../App.module.css";

export function LoginRequired({ user }: { user: User }) {
  const config = useQuery({
    queryKey: ["config"],
    queryFn: ({ signal }) => gameApi.config(signal),
  });
  return (
    <section aria-label="登录后继续">
      <p>请先使用知乎账号登录，再继续故事。</p>
      {user.identity_type === "guest" && user.guest_expires_at && (
        <p>
          在试玩有效期内登录可继承进度。有效期至
          {new Date(user.guest_expires_at).toLocaleString("zh-CN")}。
        </p>
      )}
      <a
        className={`${s.primary} ${!config.data?.zhihu_login ? s.disabled : ""}`}
        href={config.data?.zhihu_login ? "/api/auth/zhihu" : undefined}
        aria-disabled={!config.data?.zhihu_login}
      >
        知乎授权登录
      </a>
      {config.data && !config.data.zhihu_login && (
        <p>知乎登录暂不可用，请稍后再试。</p>
      )}
      <ErrorNotice error={config.error} onRetry={() => void config.refetch()} />
    </section>
  );
}
