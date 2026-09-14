import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MetricDelta } from "./MetricDelta";

afterEach(() => vi.useRealTimers());
it("shows only committed changes, expires them, and resets when switching saves", async () => {
  vi.useFakeTimers();
  const { rerender } = render(<MetricDelta key="a" version={1} value={50} />);
  expect(screen.queryByText("+50")).toBeNull();
  rerender(<MetricDelta key="a" version={1} value={55} />);
  expect(screen.queryByText("+5")).toBeNull();
  rerender(<MetricDelta key="a" version={2} value={55} />);
  expect(screen.getByText("+5")).toBeTruthy();
  rerender(<MetricDelta key="a" version={3} value={55} />);
  await act(() => vi.advanceTimersByTime(3500));
  expect(screen.queryByText("+5")).toBeNull();
  rerender(<MetricDelta key="a" version={4} value={52} />);
  expect(screen.getByText("−3")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(2000));
  rerender(<MetricDelta key="a" version={5} value={54} />);
  await act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByText("+2")).toBeTruthy();
  rerender(<MetricDelta key="b" version={10} value={20} />);
  expect(screen.queryByText("+2")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
