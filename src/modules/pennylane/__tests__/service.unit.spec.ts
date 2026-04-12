import PennylaneModuleService from "../service";
import { PennylaneClient } from "../client/pennylane-client";

const silentLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
};

describe("PennylaneModuleService construction", () => {
  it("throws when options.apiToken is missing", () => {
    expect(
      () =>
        new PennylaneModuleService(
          { logger: silentLogger as never },
          {} as never
        )
    ).toThrow(/apiToken/);
  });

  it("instantiates a PennylaneClient with the plugin options", () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t", baseUrl: "https://example.test/api/external/v2" }
    );

    const client = svc.getClient();
    expect(client).toBeInstanceOf(PennylaneClient);
    expect(client.baseUrl).toBe("https://example.test/api/external/v2");
  });

  it("healthCheck() delegates to the underlying client", async () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t" }
    );
    const delegateSpy = jest
      .spyOn(svc.getClient(), "healthCheck")
      .mockResolvedValue({
        user: {
          id: 1,
          first_name: "J",
          last_name: "D",
          email: "j@example.test",
          locale: "fr",
        },
        company: { id: 1, name: "C", reg_no: "1" },
        scopes: [],
      });

    await svc.healthCheck();

    expect(delegateSpy).toHaveBeenCalledTimes(1);
  });
});
