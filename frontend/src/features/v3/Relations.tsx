import { Button } from "@heroui/react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { isEvent } from "../../contracts";
import type { GameEvent } from "../../types";
import type { Save } from "../../types";
import { Actions, type Act, type Option } from "./Work";
import { followUpChoices } from "./followUp";
import s from "./V3.module.css";
export function Relations({
  save,
  userId,
  options,
  act,
  busy,
}: {
  save: Save;
  userId: string;
  options: Option[];
  act: Act;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const members = save.relationships ?? [];
  const person = members.find((r) => r.id === selected);
  const detail = useQuery({
    queryKey: ["relation-evidence", userId, save.id, eventId],
    enabled: !!eventId,
    queryFn: ({ signal }) =>
      api<GameEvent>(
        `/saves/${save.id}/events/${eventId}`,
        undefined,
        signal,
        true,
        isEvent,
      ),
  });
  const positions = members.map((_, index) => {
    const angle = (index * 2 * Math.PI) / members.length - Math.PI / 2;
    return { x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 34 };
  });
  function select(id: string) {
    setSelected(id);
    setEventId(null);
  }
  return (
    <>
      <div className={s.relationGraph} aria-label="以周菱菱为中心的关系图">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {positions.map((point, index) => (
            <line key={index} x1="50" y1="50" x2={point.x} y2={point.y} />
          ))}
        </svg>
        <div className={s.graphCenter}>周菱菱 · 我</div>
        {members.map((relation, index) => (
          <Button
            type="button"
            variant="secondary"
            key={relation.id}
            className={s.graphPerson}
            style={{
              left: `${positions[index]!.x}%`,
              top: `${positions[index]!.y}%`,
            }}
            aria-pressed={selected === relation.id}
            onClick={() => select(relation.id)}
          >
            {relation.name}
          </Button>
        ))}
      </div>
      <nav className={s.relationList} aria-label="人物关系列表">
        {members.map((relation) => (
          <Button
            type="button"
            variant="secondary"
            key={relation.id}
            aria-pressed={selected === relation.id}
            onClick={() => select(relation.id)}
          >
            {relation.name} · {relation.role}
          </Button>
        ))}
      </nav>
      {person ? (
        <section aria-label="关系与事实依据" className={s.panelSection}>
          <h3>{person.name}</h3>
          <p>{person.description}</p>
          {person.evidence_event_ids?.length ? (
            person.evidence_event_ids.map((id, index) => (
              <Button
                type="button"
                variant="secondary"
                key={id}
                onClick={() => setEventId(id)}
              >
                查看依据 {index + 1}
              </Button>
            ))
          ) : (
            <p>本局尚无支持关系变化的事件。</p>
          )}
          {eventId && (
            <article>
              {detail.isPending && <p role="status">正在读取原始记录…</p>}
              {detail.error && (
                <p role="alert">
                  无法读取这条记录。
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void detail.refetch()}
                  >
                    重试
                  </Button>
                </p>
              )}
              {detail.data && (
                <>
                  <small>
                    {detail.data.speaker === "system" ? "事件记录" : "本局互动"}
                  </small>
                  <p>{detail.data.text}</p>
                </>
              )}
            </article>
          )}
        </section>
      ) : (
        <p>选择一个人物，查看当前关系及其依据。</p>
      )}
      <Actions
        options={options.filter((a) =>
          [
            "cut_ties",
            "keep_distance",
            "repair_friendship",
            "acknowledge_harm",
            "complete_remedy",
          ].includes(a.action),
        )}
        act={act}
        busy={busy}
      />
      {options.some((a) => a.action === "follow_up" && a.enabled) && (
        <section>
          <h3>下一次协作</h3>
          <p>
            孙淼：这次部门聚餐，你想参加吗？工作资料会单独发给你。你可以自己决定。
          </p>
          {followUpChoices.map(([response, label]) => (
            <Button
              type="button"
              variant="secondary"
              key={response}
              isDisabled={busy}
              onClick={() =>
                act("follow_up", "sun", {
                  params: { boundary_response: response },
                })
              }
            >
              {label}
            </Button>
          ))}
        </section>
      )}
    </>
  );
}
