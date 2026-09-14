import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AttachmentPreview, workAttachments } from "./AttachmentPreview";

it.each(["purpose", "quote"] as const)(
  "opens the supplied %s document and restores focus after close",
  async (attachment) => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const close = vi.fn();
    const view = render(
      <AttachmentPreview attachment={attachment} onClose={close} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      workAttachments[attachment].src,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      workAttachments[attachment].title,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭附件预览" }));
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  },
);

it("keeps Escape and pointer events inside the nested attachment dialog", () => {
  const outerCancel = vi.fn(),
    pointer = vi.fn(),
    close = vi.fn();
  render(
    <dialog
      open
      onCancel={outerCancel}
      onPointerDown={pointer}
      onPointerUp={pointer}
    >
      <AttachmentPreview attachment="purpose" onClose={close} />
    </dialog>,
  );
  const dialog = screen.getByRole("dialog", {
    name: workAttachments.purpose.title,
  });
  fireEvent.pointerDown(dialog);
  fireEvent.pointerUp(dialog);
  const event = new Event("cancel", { bubbles: true, cancelable: true });
  fireEvent(dialog, event);
  expect(event.defaultPrevented).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  expect(outerCancel).not.toHaveBeenCalled();
  expect(pointer).not.toHaveBeenCalled();
});

it("does not restore focus to an opener removed while the document is open", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const view = render(
    <AttachmentPreview attachment="quote" onClose={() => {}} />,
  );
  opener.remove();
  const focus = vi.spyOn(opener, "focus");
  view.unmount();
  await Promise.resolve();
  expect(focus).not.toHaveBeenCalled();
});
