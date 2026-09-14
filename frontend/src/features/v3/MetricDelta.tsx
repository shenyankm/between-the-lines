import { useEffect, useRef, useState } from "react";
import s from "./V3.module.css";

/** Compare committed save versions; mounting an existing save is not a new change. */
export function MetricDelta({
  version,
  value,
}: {
  version: number;
  value: number;
}) {
  const previous = useRef({ version, value });
  const [delta, setDelta] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (version <= previous.current.version) return;
    const change = value - previous.current.value;
    previous.current = { version, value };
    if (!change) return;
    clearTimeout(timer.current);
    setDelta(change);
    timer.current = setTimeout(() => setDelta(0), 3500);
  }, [version, value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return delta ? (
    <small className={s.metricDelta}>
      {delta > 0 ? "+" : "−"}
      {Math.abs(delta)}
    </small>
  ) : null;
}
