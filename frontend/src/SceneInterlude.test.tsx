import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SceneInterlude } from "./SceneInterlude";
import { story } from "./testing/fixtures";

function drawer(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("expected SceneInterlude to render a <dialog>");
  return dialog;
}

describe("SceneInterlude", () => {
  it("opens modally and shows the monologue authored for act 1", () => {
    render(
      <SceneInterlude
        scene={story.acts[1]?.interlude ?? null}
        onClose={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(drawer().open).toBe(true);
    expect(
      screen.getByRole("heading", { name: "卧室 · 把注意力还给自己" }),
    ).toBeTruthy();
    expect(screen.getByText(/幕间独白 · 周五 · 夜间/)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "卧室 · 把注意力还给自己" }),
    ).toBeTruthy();
    expect(screen.getByText(story.acts[1]?.interlude?.text ?? "")).toBeTruthy();
  });

  it("renders nothing at all for an act that has no interlude", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const { container } = render(
      <SceneInterlude
        scene={story.acts[3]?.interlude ?? null}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("offers both an advance and a way back, and reports which was used", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    render(
      <SceneInterlude
        scene={story.acts[2]?.interlude ?? null}
        onClose={onClose}
        onContinue={onContinue}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入下一幕" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "返回当前剧情" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("treats the native cancel event (Escape) as a dismissal", () => {
    const onClose = vi.fn();
    render(
      <SceneInterlude
        scene={story.acts[1]?.interlude ?? null}
        onClose={onClose}
        onContinue={vi.fn()}
      />,
    );

    fireEvent(drawer(), new Event("cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
