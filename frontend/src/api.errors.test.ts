import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { api, ApiError } from "./api";
import { save } from "./testing/fixtures";
import { asApiError, thrown } from "./testing/errors";
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
  it("surfaces the API's own detail string together with the status", async () => {
    server.use(
      http.post("/api/saves", () =>
        HttpResponse.json(
          { detail: "存档版本已过期，请刷新后重试。" },
          { status: 409 },
        ),
      ),
    );

    const error = await thrown(api<Save>("/saves", {}));
    expect(error).toBeInstanceOf(ApiError);
    expect(asApiError(error).message).toBe("存档版本已过期，请刷新后重试。");
    expect(asApiError(error).status).toBe(409);
  });

  it("keeps a 404 distinguishable from other failures", async () => {
    server.use(
      http.get("/api/saves/:id", () =>
        HttpResponse.json({ detail: "找不到这个存档。" }, { status: 404 }),
      ),
    );

    const error = await thrown(api<Save>("/saves/missing"));
    expect(asApiError(error).status).toBe(404);
    expect(asApiError(error).message).toBe("找不到这个存档。");
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
  });

  it("falls back when the error response body is completely empty", async () => {
    server.use(
      http.get("/api/config", () => HttpResponse.text("", { status: 500 })),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    expect(asApiError(error).status).toBe(500);
  });

  it("falls back when detail is a validation-error array instead of a string", async () => {
    // FastAPI answers 422 with `detail` as a list of location/message objects.
    server.use(
      http.post("/api/saves", () =>
        HttpResponse.json(
          { detail: [{ loc: ["body", "version"], msg: "field required" }] },
          { status: 422 },
        ),
      ),
    );

    const error = await thrown(api<Save>("/saves", {}));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    expect(asApiError(error).status).toBe(422);
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

  it("falls back when detail is missing entirely", async () => {
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );

    const error = await thrown(api<unknown>("/config"));
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
  });

  it("leaves a network failure unwrapped for the caller to handle", async () => {
    server.use(http.get("/api/config", () => HttpResponse.error()));

    const error = await thrown(api<unknown>("/config"));
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(TypeError);
  });
});
