import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { api, ApiError } from "./api";
import { asApiError, thrown } from "./testing/errors";
import { save } from "./testing/fixtures";
import { server } from "./testing/server";
import type { Save } from "./types";

describe("api() request shape", () => {
  it("issues a credentialed GET with no body when none is given", async () => {
    const expected = save({ id: "save-9", version: 7 });
    let seen:
      | { method: string; contentType: string | null; credentials: string }
      | undefined;
    server.use(
      http.get("/api/saves/:id", ({ request }) => {
        seen = {
          method: request.method,
          contentType: request.headers.get("Content-Type"),
          credentials: request.credentials,
        };
        return HttpResponse.json(expected);
      }),
    );

    await expect(api<Save>("/saves/save-9")).resolves.toEqual(expected);
    expect(seen).toEqual({
      method: "GET",
      contentType: null,
      credentials: "same-origin",
    });
  });

  it("posts a JSON body when one is given", async () => {
    let seen:
      | { method: string; contentType: string | null; body: string }
      | undefined;
    server.use(
      http.post("/api/saves", async ({ request }) => {
        seen = {
          method: request.method,
          contentType: request.headers.get("Content-Type"),
          body: await request.text(),
        };
        return HttpResponse.json(save(), { status: 201 });
      }),
    );

    await api<Save>("/saves", {});
    expect(seen).toEqual({
      method: "POST",
      contentType: "application/json",
      body: "{}",
    });
  });
});

describe("api() error branches", () => {
  it("surfaces the envelope's message, status, code and correlation id", async () => {
    server.use(
      http.post("/api/saves", () =>
        HttpResponse.json(
          {
            error: {
              code: "version_conflict",
              message: "进度已变化，请刷新后重试。",
              request_id: "req-409",
            },
          },
          { status: 409 },
        ),
      ),
    );

    const error = await thrown(api<Save>("/saves", {}));
    expect(error).toBeInstanceOf(ApiError);
    const described = asApiError(error);
    expect(described.message).toBe("进度已变化，请刷新后重试。");
    expect(described.status).toBe(409);
    // The code is what a caller may branch on; the prose is allowed to change.
    expect(described.code).toBe("version_conflict");
    expect(described.requestId).toBe("req-409");
  });

  it("keeps a 404 distinguishable from other failures", async () => {
    server.use(
      http.get("/api/saves/:id", () =>
        HttpResponse.json(
          {
            error: {
              code: "save_not_found",
              message: "存档不存在。",
              request_id: "req-404",
            },
          },
          { status: 404 },
        ),
      ),
    );

    const error = await thrown(api<Save>("/saves/missing"));
    expect(asApiError(error).status).toBe(404);
    expect(asApiError(error).code).toBe("save_not_found");
    expect(asApiError(error).message).toBe("存档不存在。");
  });

  it("falls back when the error response carries no parseable JSON body", async () => {
    // What a proxy or an HTML error page looks like: non-JSON, so response.json()
    // rejects and the wrapper must still produce a usable Chinese message.
    server.use(
      http.get("/api/config", () =>
        HttpResponse.text("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    expect(asApiError(error).status).toBe(502);
    expect(asApiError(error).code).toBeUndefined();
  });

  it("falls back when the error response body is completely empty", async () => {
    server.use(
      http.get("/api/config", () => HttpResponse.text("", { status: 500 })),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    expect(asApiError(error).status).toBe(500);
  });

  it("falls back when the body is JSON null", async () => {
    // typeof null === "object", so this is its own branch rather than a variant
    // of the missing-envelope one.
    server.use(
      http.get("/api/config", () => HttpResponse.json(null, { status: 500 })),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
  });

  it("falls back when the payload has no error key at all", async () => {
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json(
          { detail: "an older or foreign shape" },
          { status: 500 },
        ),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
  });

  it("falls back when error is a string rather than an object", async () => {
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
  });

  it("falls back when error is null", async () => {
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json({ error: null }, { status: 500 }),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
  });

  it("falls back when the payload is JSON but not an object", async () => {
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json("服务暂时不可用", { status: 503 }),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    expect(asApiError(error).status).toBe(503);
  });

  it("falls back when the envelope's message is not a string", async () => {
    server.use(
      http.post("/api/saves", () =>
        HttpResponse.json(
          { error: { code: "validation_failed", message: 42 } },
          { status: 422 },
        ),
      ),
    );

    const error = await thrown(api<Save>("/saves", {}));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    // The code is still trustworthy even though the prose was not.
    expect(asApiError(error).code).toBe("validation_failed");
  });

  it("falls back when the envelope's message is empty", async () => {
    // An empty banner is worse than a generic one, so an empty string is treated
    // as absent rather than rendered.
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json(
          { error: { code: "internal_error", message: "", request_id: "r" } },
          { status: 500 },
        ),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    expect(asApiError(error).requestId).toBe("r");
  });

  it("omits code and requestId when the envelope does not carry them", async () => {
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json(
          { error: { message: "服务暂时不可用。", code: 7, request_id: null } },
          { status: 503 },
        ),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("服务暂时不可用。");
    expect(asApiError(error).code).toBeUndefined();
    expect(asApiError(error).requestId).toBeUndefined();
  });

  it("leaves a network failure unwrapped for the caller to handle", async () => {
    server.use(http.get("/api/config", () => HttpResponse.error()));

    const error = await thrown(api<unknown>("/config"));
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(TypeError);
  });
});
