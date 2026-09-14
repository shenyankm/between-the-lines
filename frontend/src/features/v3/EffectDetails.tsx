import type { GameEvent } from "../../types";
import { record } from "../../contracts";

const metricNames = {
  credit: "专业信用",
  rumination: "内耗",
  pressure: "工作压力",
  heat: "舆论温度",
};

export function EffectDetails({ event }: { event: GameEvent }) {
  if (!event.effects?.length || event.speaker !== "system") return null;
  return (
    <div aria-label="已提交的状态变化">
      {event.effects.map((effect, index) => {
        const changes = record(effect.changes) ? effect.changes : {};
        const deltas = Object.entries(metricNames).flatMap(([key, label]) => {
          const value = changes[key];
          return typeof value === "number" &&
            Number.isFinite(value) &&
            value !== 0
            ? [`${label} ${value > 0 ? "+" : ""}${value}`]
            : [];
        });
        const facts = Array.isArray(effect.facts)
          ? effect.facts.filter(record)
          : [];
        return (
          <div key={index}>
            <p>{deltas.length ? deltas.join("；") : "本次没有指标增减。"}</p>
            {deltas.length > 0 && typeof effect.text === "string" && (
              <p>变化原因：{effect.text}</p>
            )}
            {facts.length > 0 && (
              <details>
                <summary>事项记录的变化</summary>
                <ul>
                  {facts.map((fact, i) => (
                    <li key={i}>
                      {typeof fact.before === "string" && (
                        <p>此前：{fact.before}</p>
                      )}
                      <p>
                        {typeof fact.after === "string"
                          ? `已记录：${fact.after}`
                          : "此前的验证已失效，需要依据后续实际行动重新验证。"}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
