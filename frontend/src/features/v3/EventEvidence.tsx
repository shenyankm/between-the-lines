import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { api } from "../../api";
import { isEvent } from "../../contracts";
import { ErrorNotice } from "../../ErrorNotice";
import type { GameEvent } from "../../types";

const names: Record<string, string> = {
  sun: "孙淼",
  li: "李姐",
  zhang: "张工",
  wang: "王会计",
  player: "周菱菱",
  system: "系统记录",
  narrator: "旁白",
};

export function EventEvidence({
  saveId,
  eventId,
}: {
  saveId: string;
  eventId: string;
}) {
  const [open, setOpen] = useState(false);
  const evidence = useQuery({
    queryKey: ["receipt-evidence", saveId, eventId],
    enabled: open,
    queryFn: ({ signal }) =>
      api<GameEvent>(
        `/saves/${saveId}/events/${eventId}`,
        undefined,
        signal,
        true,
        isEvent,
      ),
  });
  return (
    <div>
      <Button
        variant="secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        查看原始事件
      </Button>
      {open && (
        <blockquote>
          {evidence.isPending && <p role="status">正在读取原始记录…</p>}
          <ErrorNotice
            error={evidence.error}
            onRetry={() => void evidence.refetch()}
          />
          {evidence.data && (
            <>
              <small>
                第 {evidence.data.act} 幕 ·{" "}
                {
                  {
                    scene: "现场",
                    dm: "私聊",
                    group: "工作群",
                    work: "工作系统",
                  }[evidence.data.channel ?? "scene"]
                }{" "}
                · 事件记录 · 对象：
                {names[evidence.data.npc] ?? evidence.data.npc}
                {evidence.data.speaker &&
                  ` · 记录者：${names[evidence.data.speaker] ?? evidence.data.speaker}`}
              </small>
              <p>{evidence.data.text}</p>
            </>
          )}
        </blockquote>
      )}
    </div>
  );
}
