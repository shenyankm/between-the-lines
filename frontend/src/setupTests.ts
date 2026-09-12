import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./testing/server";

/*
 * jsdom 30 implements HTMLDialogElement's `open` attribute but none of its
 * methods. Play's drawer calls showModal()/close() from an effect and
 * SceneInterlude calls showModal() on mount, so supply the slice of the HTML
 * dialog spec those components depend on. Everything else about the element
 * stays jsdom's.
 */
const dialog = HTMLDialogElement.prototype;
if (typeof dialog.showModal !== "function") {
  const alreadyOpen = () =>
    new DOMException("The dialog is already open.", "InvalidStateError");

  dialog.show = function show(this: HTMLDialogElement) {
    if (this.open) throw alreadyOpen();
    this.returnValue = "";
    this.setAttribute("open", "");
  };

  dialog.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) throw alreadyOpen();
    this.returnValue = "";
    this.setAttribute("open", "");
  };

  dialog.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return;
    this.removeAttribute("open");
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

beforeAll(() => {
  // A request no test registered a handler for is a bug in the test, not a
  // reason to fall through to the network.
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  sessionStorage.clear();
  localStorage.clear();
});

afterAll(() => {
  server.close();
});
