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

    const result = await client.delete("/customer_invoices/1/matched_transactions/42");

    expect(result).toBeUndefined();
    const { init } = getFetchCall(fetchSpy);
    expect(init.method).toBe("DELETE");
  });
});
