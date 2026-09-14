import { Button } from "@heroui/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { isEvent } from "../../contracts";
import { ErrorNotice } from "../../ErrorNotice";

export function EventHistory({
  userId,
  saveId,
  version,
}: {
  userId: string;
  saveId: string;
  version: number;
}) {
  const history = useInfiniteQuery({
    queryKey: ["event-history", userId, saveId, version],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const rows = await api<unknown>(
        `/saves/${saveId}/events?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
        undefined,
        signal,
      );
      if (!Array.isArray(rows) || !rows.every(isEvent))
        throw new Error("历史记录格式无效，请重试。");
      return rows;
    },
    getNextPageParam: (last) => (last.length === 50 ? last[0]?.id : undefined),
  });
  const rows = [...(history.data?.pages ?? [])].reverse().flat();
  return (
    <section aria-label="完整历史记录">
      {history.error && (
        <ErrorNotice
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      )}
      {history.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          isDisabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          加载更早记录
        </Button>
      )}
      {history.isPending && <p role="status">正在读取历史…</p>}
      {!history.isPending && !history.error && !rows.length && (
        <p>本局尚无已保存的历史记录。</p>
      )}
      {rows.map((event) => (
        <article key={event.id}>
          <small>
            {event.channel === "dm"
              ? "私聊"
              : event.channel === "group"
                ? "工作群"
                : event.channel === "work"
                  ? "工作系统"
                  : "现场"}{" "}
            ·{" "}
            {event.speaker === "system"
              ? "事件记录"
              : event.kind === "npc"
                ? { sun: "孙淼", li: "李姐", zhang: "张工", wang: "王会计" }[
                    event.npc
                  ]
                : "我"}
          </small>
          <p>{event.text}</p>
        </article>
      ))}
    </section>
  );
}
