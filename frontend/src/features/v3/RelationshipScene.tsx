import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { isEvent } from "../../contracts";
import { ErrorNotice } from "../../ErrorNotice";
import type { GameEvent } from "../../types";
import type { StateV3 } from "./Work";
import { EventEvidence } from "./EventEvidence";

export function RelationshipScene({
  state,
  saveId,
}: {
  state: StateV3;
  saveId: string;
}) {
  const facts = state.relationship?.facts ?? {};
  const records = [
    ["friendship_offer", "我 · 表达意愿"],
    ["harm", "孙淼 · 回应与承认伤害"],
    ["remedy", "孙淼 · 具体补救"],
    ["sun_cut", "我 · 职业边界"],
    ["sun_observe", "我 · 暂不决定"],
    ["follow_up_response", "我 · 回应后续邀请"],
    ["follow_up", "孙淼 · 后续协作回应"],
  ].flatMap(([key, label]) =>
    facts[key!] ? [{ key, label, fact: facts[key!]! }] : [],
  );
  const ids = records.map((row) => row.fact.event_id);
  const history = useQuery({
    queryKey: ["relationship-scene", saveId, ids.join(":")],
    enabled: ids.length > 0,
    queryFn: async ({ signal }) => {
      const remaining = new Set(ids);
      let cursor = "";
      let ordered: GameEvent[] = [];
      while (remaining.size) {
        const page = await api<GameEvent[]>(
          `/saves/${saveId}/events?limit=100${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
          undefined,
          signal,
          true,
          (v): v is GameEvent[] => Array.isArray(v) && v.every(isEvent),
        );
        ordered = [
          ...page.filter((event) => remaining.has(event.id)),
          ...ordered,
        ];
        page.forEach((event) => remaining.delete(event.id));
        if (page.length < 100 || !page[0] || page[0].id === cursor) break;
        cursor = page[0].id;
      }
      return ordered;
    },
  });
  return (
    <section aria-label="关系回应场景">
      <h3>这段关系中的回应</h3>
      {records.length ? (
        <>
          {history.isPending && <p role="status">正在按发生顺序读取回应…</p>}
          <ErrorNotice
            error={history.error}
            onRetry={() => void history.refetch()}
          />
          <ol>
            {history.data?.map((event) => (
              <li key={event.id}>
                <h4>
                  {records.find((row) => row.fact.event_id === event.id)?.label}
                </h4>
                <p>{event.text}</p>
                <EventEvidence saveId={saveId} eventId={event.id} />
              </li>
            ))}
          </ol>
          {(history.isError ||
            (history.data && history.data.length < new Set(ids).size)) && (
            <details>
              <summary>当前事实摘要（部分原始回应尚未读取）</summary>
              {records.map((row) => (
                <p key={row.key}>
                  {row.label}：{row.fact.detail}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <p>目前尚无修复或关系决定的记录。你可以先决定是否表达意愿。</p>
      )}
      {facts.friendship_offer && !facts.harm && (
        <p>
          你已提出意愿，孙淼尚未回应。继续谈具体伤害时，才会记录下一段回应。
        </p>
      )}
      {facts.harm && (
        <p>
          承认伤害是孙淼的回应；是否恢复友谊仍由你决定。你可以继续了解补救、暂不决定，或只保留职业关系。
        </p>
      )}
      {facts.remedy && (
        <p>
          这些补救已经发生，但不等于信任完全恢复、伤害消失或你已经原谅。下一次协作仍要看实际行动。
        </p>
      )}
      <p>工作合作与资料交接不以参加聚餐、原谅或恢复亲密为条件。</p>
    </section>
  );
}
