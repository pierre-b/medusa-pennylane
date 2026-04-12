import { PennylaneClient } from "../pennylane-client";

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
