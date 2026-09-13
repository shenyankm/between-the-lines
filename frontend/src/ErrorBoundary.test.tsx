import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { ApiError } from "./api";
import { setReporter, type Report } from "./reporting";

function Boom({ error }: { error: unknown }): never {
  throw error;
}

/** React logs every caught render error; without this the suite is unreadable. */
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function capture(): Report[] {
  const seen: Report[] = [];
  const restore = setReporter((entry) => seen.push(entry));
  afterEach(restore);
  return seen;
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>仍在进行</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("仍在进行")).toBeTruthy();
  });

  it("replaces a blank page with a recovery prompt and reports the failure", () => {
    const seen = capture();
    render(
      <ErrorBoundary>
        <Boom error={new Error("render blew up")} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "刷新页面" })).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(
      expect.objectContaining({ kind: "render", message: "render blew up" }),
    );
    // The component path is what makes a render failure actionable, and it is a list
    // of component names rather than anything the player typed.
    expect(seen[0]?.componentStack).toContain("Boom");
  });

  it("shows the request id a player can quote, and nothing else from the error", () => {
    render(
      <ErrorBoundary>
        <Boom
          error={
            new ApiError(
              "服务器内部错误，请稍后重试。",
              500,
              "internal_error",
              "49a5919536b04f36b25e1fe691278437",
            )
          }
        />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/49a5919536b04f36b25e1fe691278437/)).toBeTruthy();
    // The envelope's own text is not echoed back. It is a constant the backend chose
    // for a log, and the player needs the recovery prompt instead.
    expect(screen.queryByText(/服务器内部错误/)).toBeNull();
  });

  it("omits the request id when the failure did not come from the API", () => {
    render(
      <ErrorBoundary>
        <Boom error={new TypeError("undefined is not an object")} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).not.toContain("请求编号");
  });
});
