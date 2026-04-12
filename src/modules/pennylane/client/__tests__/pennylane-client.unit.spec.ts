import {
  PennylaneAuthError,
  PennylaneForbiddenError,
  PennylaneNetworkError,
  PennylaneNotFoundError,
  PennylaneServerError,
  PennylaneValidationError,
} from "../errors";
import { PennylaneClient } from "../pennylane-client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const buildClient = (overrides: Partial<{ baseUrl: string }> = {}) =>
  new PennylaneClient({
    apiToken: "test-token",
    baseUrl: overrides.baseUrl ?? "https://example.test/api/external/v2",
  });

const getFetchCall = (spy: jest.SpyInstance) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit | undefined];
  return { url, init: init ?? {} };
};

const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Expected promise to reject");
};

const getHeaders = (init: RequestInit): Record<string, string> => {
  const headers = init.headers;
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
};

describe("PennylaneClient construction", () => {
  it("throws when apiToken is missing", () => {
    expect(
      () => new PennylaneClient({} as unknown as { apiToken: string })
    ).toThrow(/apiToken/);
  });

  it("applies default baseUrl and requestTimeoutMs", () => {
    const client = new PennylaneClient({ apiToken: "t" });
    expect(client.baseUrl).toBe("https://app.pennylane.com/api/external/v2");
    expect(client.requestTimeoutMs).toBe(10_000);
  });

  it("respects explicit baseUrl and requestTimeoutMs overrides", () => {
    const client = new PennylaneClient({
      apiToken: "t",
      baseUrl: "https://staging.pennylane.example/api/external/v2",
      requestTimeoutMs: 2_000,
    });
    expect(client.baseUrl).toBe(
      "https://staging.pennylane.example/api/external/v2"
    );
    expect(client.requestTimeoutMs).toBe(2_000);
  });

  it("strips trailing slashes from baseUrl", () => {
    const client = new PennylaneClient({
      apiToken: "t",
      baseUrl: "https://example.com/api/external/v2/",
    });
    expect(client.baseUrl).toBe("https://example.com/api/external/v2");
  });
});

describe("PennylaneClient GET", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns the parsed JSON body on 200", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ hello: "world" }));
    const client = buildClient();

    const body = await client.get<{ hello: string }>("/customers");

    expect(body).toEqual({ hello: "world" });
  });

  it("sends Authorization Bearer header with the configured apiToken", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    const client = buildClient();

    await client.get("/customers");

    const { init } = getFetchCall(fetchSpy);
    expect(getHeaders(init).Authorization).toBe("Bearer test-token");
  });

  it("sends Accept: application/json header", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    const client = buildClient();

    await client.get("/customers");

    const { init } = getFetchCall(fetchSpy);
    expect(getHeaders(init).Accept).toBe("application/json");
  });

  it("joins baseUrl and path cleanly regardless of trailing/leading slashes", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    const client = buildClient({
      baseUrl: "https://example.test/api/external/v2/",
    });

    await client.get("/customers");

    const { url } = getFetchCall(fetchSpy);
    expect(url).toBe("https://example.test/api/external/v2/customers");
  });

  it("serializes query params, drops undefined, and repeats array values", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    const client = buildClient();

    await client.get("/customers", {
      query: {
        page: 2,
        per_page: 10,
        missing: undefined,
        ids: [1, 2, 3],
        active: true,
      },
    });

    const { url } = getFetchCall(fetchSpy);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/external/v2/customers");
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("per_page")).toBe("10");
    expect(parsed.searchParams.getAll("ids")).toEqual(["1", "2", "3"]);
    expect(parsed.searchParams.get("active")).toBe("true");
    expect(parsed.searchParams.has("missing")).toBe(false);
  });
});

describe("PennylaneClient write verbs", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("POST serializes body to JSON and sets Content-Type", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ id: 42 }, 201));
    const client = buildClient();

    const result = await client.post<{ id: number }>("/customer_invoices", {
      body: { foo: "bar" },
    });

    expect(result).toEqual({ id: 42 });
    const { init } = getFetchCall(fetchSpy);
    expect(init.method).toBe("POST");
    expect(getHeaders(init)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("POST without body does not set Content-Type or send a body", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
    const client = buildClient();

    await client.post("/customer_invoices/1/finalize");

    const { init } = getFetchCall(fetchSpy);
    expect(init.method).toBe("POST");
    expect(getHeaders(init)["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("PUT serializes body like POST", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
    const client = buildClient();

    await client.put("/customer_invoices/1/finalize", { body: { a: 1 } });

    const { init } = getFetchCall(fetchSpy);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("DELETE on a 204 response returns undefined without parsing JSON", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    const client = buildClient();

    const result = await client.delete(
      "/customer_invoices/1/matched_transactions/42"
    );

    expect(result).toBeUndefined();
    const { init } = getFetchCall(fetchSpy);
    expect(init.method).toBe("DELETE");
  });
});

describe("PennylaneClient error mapping", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("maps 401 to PennylaneAuthError with the Pennylane error message", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: "The access token is invalid", status: 401 }, 401)
    );
    const client = buildClient();

    const err = await captureError(client.get("/me"));
    expect(err).toBeInstanceOf(PennylaneAuthError);
    expect(err).toMatchObject({
      status: 401,
      message: "The access token is invalid",
      pennylaneBody: { error: "The access token is invalid", status: 401 },
    });
  });

  it("maps 403 to PennylaneForbiddenError", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          error: 'Access to this resource requires scope "ledger".',
          status: 403,
        },
        403
      )
    );
    const client = buildClient();

    const err = await captureError(client.get("/ledger_entries"));
    expect(err).toBeInstanceOf(PennylaneForbiddenError);
  });

  it("maps 404 to PennylaneNotFoundError", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: "Not Found", status: 404 }, 404)
    );
    const client = buildClient();

    const err = await captureError(
      client.get("/customer_invoices/does-not-exist")
    );
    expect(err).toBeInstanceOf(PennylaneNotFoundError);
  });

  it("maps 422 to PennylaneValidationError with flat {error,status} shape", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: "Entry lines are not balanced", status: 422 }, 422)
    );
    const client = buildClient();

    const err = await captureError(
      client.post("/customer_invoices", { body: {} })
    );
    expect(err).toBeInstanceOf(PennylaneValidationError);
    expect(err).toMatchObject({
      status: 422,
      message: "Entry lines are not balanced",
    });
  });

  it("maps 400 variant A ({error,status}) to PennylaneValidationError", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: "Bad Request", status: 400 }, 400)
    );
    const client = buildClient();

    const err = await captureError(
      client.post("/customer_invoices", { body: {} })
    );
    expect(err).toBeInstanceOf(PennylaneValidationError);
    expect(err).toMatchObject({
      status: 400,
      message: "Bad Request",
    });
    expect((err as PennylaneValidationError).code).toBeUndefined();
    expect((err as PennylaneValidationError).field).toBeUndefined();
  });

  it("maps 400 variant B ({message,code}) to PennylaneValidationError with .code", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { message: "Invalid date format", code: "InvalidDateFormat" },
        400
      )
    );
    const client = buildClient();

    const err = await captureError(
      client.post("/customer_invoices", { body: {} })
    );
    expect(err).toBeInstanceOf(PennylaneValidationError);
    expect(err).toMatchObject({
      status: 400,
      message: "Invalid date format",
      code: "InvalidDateFormat",
    });
  });

  it("maps 400 variant C ({message,code,field}) with .code and .field", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          message: "Invalid email format",
          code: "InvalidEmailFormat",
          field: "emails[0]",
        },
        400
      )
    );
    const client = buildClient();

    const err = await captureError(
      client.post("/individual_customers", { body: {} })
    );
    expect(err).toBeInstanceOf(PennylaneValidationError);
    expect(err).toMatchObject({
      status: 400,
      message: "Invalid email format",
      code: "InvalidEmailFormat",
      field: "emails[0]",
    });
  });

  it.each([500, 502, 503, 504])(
    "maps %i to PennylaneServerError",
    async (status) => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ error: "Internal server error", status }, status)
      );
      const client = buildClient();

      const err = await captureError(client.get("/customer_invoices"));
      expect(err).toBeInstanceOf(PennylaneServerError);
    }
  );

  it("falls back gracefully when the error body is not JSON", async () => {
    fetchSpy.mockResolvedValue(
      new Response("<html>Gateway timeout</html>", {
        status: 504,
        headers: { "Content-Type": "text/html" },
      })
    );
    const client = buildClient();

    const err = await captureError(client.get("/customer_invoices"));
    expect(err).toBeInstanceOf(PennylaneServerError);
    expect(err).toMatchObject({
      status: 504,
      pennylaneBody: null,
      message: "Pennylane request failed with status 504",
    });
  });
});

describe("PennylaneClient network + timeout", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  it("wraps a fetch() rejection in PennylaneNetworkError with cause", async () => {
    const cause = new TypeError("ECONNREFUSED");
    fetchSpy.mockRejectedValue(cause);
    const client = buildClient();

    const err = await captureError(client.get("/customer_invoices"));
    expect(err).toBeInstanceOf(PennylaneNetworkError);
    expect(err).toMatchObject({ status: null, pennylaneBody: null });
    expect((err as PennylaneNetworkError & { cause?: unknown }).cause).toBe(
      cause
    );
  });

  it("aborts the request after requestTimeoutMs and raises a timeout error", async () => {
    jest.useFakeTimers();
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          const signal = (init as RequestInit).signal;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const client = new PennylaneClient({
      apiToken: "t",
      baseUrl: "https://example.test/api/external/v2",
      requestTimeoutMs: 50,
    });

    const promise = client.get("/slow");
    jest.advanceTimersByTime(51);
    const err = await captureError(promise);
    expect(err).toBeInstanceOf(PennylaneNetworkError);
    expect((err as Error).message).toMatch(/timed out/i);
    expect((err as Error).message).toMatch(/50/);
  });

  it("honors per-call timeoutMs override", async () => {
    jest.useFakeTimers();
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          const signal = (init as RequestInit).signal;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const client = new PennylaneClient({
      apiToken: "t",
      baseUrl: "https://example.test/api/external/v2",
      requestTimeoutMs: 10_000,
    });

    const promise = client.get("/slow", { timeoutMs: 25 });
    jest.advanceTimersByTime(26);
    const err = await captureError(promise);
    expect(err).toBeInstanceOf(PennylaneNetworkError);
    expect((err as Error).message).toMatch(/25/);
  });
});

describe("PennylaneClient logging and redaction", () => {
  let fetchSpy: jest.SpyInstance;
  let logger: {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const buildLoggedClient = (apiToken = "test-token") =>
    new PennylaneClient({
      apiToken,
      baseUrl: "https://example.test/api/external/v2",
      logger,
    });

  it("logs successful requests at info with method/path/status/durationMs/requestId", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
    const client = buildLoggedClient();

    await client.get("/customer_invoices", { query: { page: 2 } });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [, context] = logger.info.mock.calls[0];
    expect(context.method).toBe("GET");
    expect(context.path).toBe("/customer_invoices");
    expect(context.status).toBe(200);
    expect(typeof context.durationMs).toBe("number");
    expect(typeof context.requestId).toBe("string");
    expect(context.requestId).toHaveLength(36); // uuid
  });

  it("does not log the body, query, or token on success", async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ ok: true }));
    const client = buildLoggedClient("super-secret-token-12345");

    await client.get("/customer_invoices", { query: { page: 2, secret: "x" } });
    await client.post("/customer_invoices", { body: { huge: "payload" } });

    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).not.toContain("super-secret-token-12345");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("huge");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("page=2");
  });

  it("logs 4xx responses at warn level", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: "Not Found", status: 404 }, 404)
    );
    const client = buildLoggedClient();

    await captureError(client.get("/customer_invoices/missing"));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    const [, context] = logger.warn.mock.calls[0];
    expect(context.status).toBe(404);
    expect(context.errorMessage).toBe("Not Found");
  });

  it("logs 5xx responses at error level", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: "Boom", status: 500 }, 500)
    );
    const client = buildLoggedClient();

    await captureError(client.get("/customer_invoices"));

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, context] = logger.error.mock.calls[0];
    expect(context.status).toBe(500);
  });

  it("logs network errors at error level with status='network'", async () => {
    fetchSpy.mockRejectedValue(new TypeError("ECONNREFUSED"));
    const client = buildLoggedClient();

    await captureError(client.get("/customer_invoices"));

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, context] = logger.error.mock.calls[0];
    expect(context.status).toBe("network");
    expect(context.errorMessage).toMatch(/ECONNREFUSED/);
  });

  it("never leaks the apiToken into thrown error stringifications", async () => {
    const token = "abcd-1234-secret-xyz-987";
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: "Not Found", status: 404 }, 404)
    );
    const client = new PennylaneClient({
      apiToken: token,
      baseUrl: "https://example.test/api/external/v2",
    });

    const err = await captureError(client.get("/customer_invoices/missing"));
    const serialized =
      JSON.stringify(err) + String(err) + ((err as Error).stack ?? "");
    expect(serialized).not.toContain(token);
  });
});
