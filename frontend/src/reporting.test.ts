import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import {
  installGlobalErrorHandlers,
  normalise,
  report,
  setReporter,
  type Report,
} from "./reporting";

/**
 * This file's directory, as a real filesystem path.
 *
 * Not `import.meta.url`: under the jsdom environment that is an http URL pointing at
 * the transformed module, whose pathname has no meaning on disk. Vitest's own record
 * of the running file is a real path, and reading it keeps the walk below independent
 * of the directory the suite was launched from.
 */
function srcDir(): string {
  const here = expect.getState().testPath;
  if (!here) throw new Error("vitest did not report a path for this file");
  return dirname(here);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Collect everything the installed reporter was handed, and undo it afterwards. */
function capture(): Report[] {
  const seen: Report[] = [];
  const restore = setReporter((entry) => seen.push(entry));
  // Registered on the vitest queue rather than returned, so a failing assertion
  // still leaves the no-op default in place for the next test.
  afterEach(restore);
  return seen;
}

describe("normalise()", () => {
  it("carries the envelope's code and request id through an ApiError", () => {
    const error = new ApiError(
      "请求未完成。",
      429,
      "daily_limit_reached",
      "abc123",
    );
    const payload = normalise("query", error);
    expect(payload).toMatchObject({
      kind: "query",
      message: "请求未完成。",
      code: "daily_limit_reached",
      requestId: "abc123",
    });
    expect(typeof payload.stack).toBe("string");
  });

  it("omits absent fields rather than sending them as undefined", () => {
    // A transport serialises this to JSON, where an explicit undefined and a missing
    // key are the same on the wire but not the same to read back.
    const payload = normalise("render", new ApiError("请求未完成。", 500));
    expect("code" in payload).toBe(false);
    expect("requestId" in payload).toBe(false);
  });

  it("keeps a plain Error's message and stack", () => {
    const payload = normalise("uncaught", new Error("浏览器无法读取回复。"));
    expect(payload.message).toBe("浏览器无法读取回复。");
    expect(payload.stack).toContain("Error");
  });

  it("survives the values JavaScript allows to be thrown", () => {
    expect(normalise("rejection", "just a string").message).toBe(
      "just a string",
    );
    expect(normalise("rejection", null).message).toBe("null");
    expect(normalise("rejection", { code: 7 }).message).toBe("[object Object]");
  });

  it("clips a stack longer than the limit", () => {
    const error = new Error("deep");
    error.stack = "x".repeat(9000);
    const clipped = normalise("uncaught", error).stack!;
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipped.length).toBeLessThan(2100);
  });
});

describe("report()", () => {
  it("forwards to the installed transport", () => {
    const seen = capture();
    report(
      "query",
      new ApiError("请求未完成。", 503, "model_unconfigured", "rid-1"),
    );
    expect(seen).toEqual([
      expect.objectContaining({
        kind: "query",
        code: "model_unconfigured",
        requestId: "rid-1",
      }),
    ]);
  });

  it("sends nothing by default", () => {
    // The null transport is the shipped behaviour: no reporter is installed, so this
    // must neither throw nor reach the network.
    expect(() => report("uncaught", new Error("boom"))).not.toThrow();
  });

  it("attaches a component stack when one is given", () => {
    const seen = capture();
    report("render", new Error("boom"), "at Boom\n    at ErrorBoundary");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.componentStack).toBe("at Boom\n    at ErrorBoundary");
  });

  it("restores the previous transport", () => {
    const first: Report[] = [];
    const second: Report[] = [];
    const undoFirst = setReporter((entry) => first.push(entry));
    const undoSecond = setReporter((entry) => second.push(entry));
    report("query", new Error("a"));
    undoSecond();
    report("query", new Error("b"));
    undoFirst();
    expect(second.map((entry) => entry.message)).toEqual(["a"]);
    expect(first.map((entry) => entry.message)).toEqual(["b"]);
  });

  it("swallows a transport that throws", () => {
    // Every caller is already handling a failure. A transport that throws must not
    // turn a rendered error into an uncaught one.
    setReporter(() => {
      throw new Error("transport down");
    });
    afterEach(setReporter(() => {}));
    expect(() => report("uncaught", new Error("boom"))).not.toThrow();
  });
});

/**
 * Fire the two window events, carrying only the properties the handlers read.
 *
 * Plain Events rather than ErrorEvent and PromiseRejectionEvent: jsdom re-throws an
 * ErrorEvent that nothing handled, which turns the listener-removal test below into an
 * uncaught exception in the suite. The handlers read `.error`, `.reason` and
 * `.message`, so this dispatches exactly what they look at.
 */
function fireError(payload: { error?: unknown; message?: string }): void {
  window.dispatchEvent(Object.assign(new Event("error"), payload));
}

function fireRejection(reason: unknown): void {
  window.dispatchEvent(
    Object.assign(new Event("unhandledrejection"), { reason }),
  );
}

describe("installGlobalErrorHandlers()", () => {
  it("reports an uncaught error", () => {
    const seen = capture();
    const remove = installGlobalErrorHandlers();
    fireError({ error: new Error("handler failed") });
    remove();
    expect(seen).toEqual([
      expect.objectContaining({ kind: "uncaught", message: "handler failed" }),
    ]);
  });

  it("falls back to the event's message when it carries no error object", () => {
    // A resource that failed to load fires an error event with no `error`, only a
    // message. Dropping it would lose the one signal that an asset is missing.
    const seen = capture();
    const remove = installGlobalErrorHandlers();
    fireError({ message: "script failed to load" });
    remove();
    expect(seen[0]).toEqual(
      expect.objectContaining({ message: "script failed to load" }),
    );
  });

  it("reports an unhandled promise rejection", () => {
    const seen = capture();
    const remove = installGlobalErrorHandlers();
    fireRejection(
      new ApiError("请求未完成。", 409, "version_conflict", "rid-9"),
    );
    remove();
    expect(seen).toEqual([
      expect.objectContaining({
        kind: "rejection",
        code: "version_conflict",
        requestId: "rid-9",
      }),
    ]);
  });

  it("detaches exactly the listeners it attached", () => {
    // Proven by reference identity rather than by dispatching again: an "error" event
    // fired with no application listener is picked up by the runner's own window
    // handler and reported as an uncaught exception, so it cannot be used here. The
    // identity check is also the stronger claim -- matching event names would pass
    // while removeEventListener silently did nothing, because it only removes the
    // very function object it is given.
    const attached = vi.spyOn(window, "addEventListener");
    const detached = vi.spyOn(window, "removeEventListener");

    const remove = installGlobalErrorHandlers();
    remove();

    expect(attached.mock.calls.map(([type]) => type)).toEqual([
      "error",
      "unhandledrejection",
    ]);
    expect(detached.mock.calls).toEqual(attached.mock.calls);
  });
});

/**
 * Shipped sources only. Tests and test helpers throw messages built from values all
 * the time -- that is what an assertion failure looks like -- and none of it reaches
 * a player's browser.
 */
function shippedSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "generated" && entry.name !== "testing")
          walk(join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.includes(".test.") || entry.name === "setupTests.ts")
        continue;
      found.push(join(dir, entry.name));
    }
  };
  walk(srcDir());
  return found.sort();
}

/** Throw sites whose message could have been built out of a runtime value. */
function unsafeMessages(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bad: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isThrowStatement(node) && ts.isNewExpression(node.expression)) {
      const message = node.expression.arguments?.[0];
      // Two shapes are safe. A string literal was written by a developer. A
      // `.message` property access is the server's own envelope text, which api.ts
      // parses out of the response -- the backend keeps player input out of those by
      // construction, and SECURITY.md's redaction tests are what hold it there.
      // Anything else, and a template with substitutions above all, could be
      // carrying the text of the turn being submitted.
      const literal = message !== undefined && ts.isStringLiteral(message);
      const envelope =
        message !== undefined &&
        ts.isPropertyAccessExpression(message) &&
        message.name.text === "message";
      if (!literal && !envelope) {
        const { line } = parsed.getLineAndCharacterOfPosition(
          node.getStart(parsed),
        );
        bad.push(`${relative(srcDir(), file)}:${line + 1}`);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return bad;
}

describe("what a report is allowed to contain", () => {
  it("builds no thrown message out of a runtime value", () => {
    const files = shippedSources();
    // The walk is only worth running if it saw the files it claims to. Without these
    // two assertions a path bug would make it pass by finding nothing at all.
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((file) => file.endsWith("api.ts"))).toBe(true);
    expect(files.flatMap(unsafeMessages)).toEqual([]);
  });
});
