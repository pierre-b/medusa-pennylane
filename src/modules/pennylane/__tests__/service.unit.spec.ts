import PennylaneModuleService from "../service";
import { PennylaneClient } from "../client/pennylane-client";
import { PspMapperRegistry } from "../psp/registry";
import { stripeMapper } from "../psp/stripe-mapper";

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

describe("PennylaneModuleService PSP registry wiring", () => {
  it("exposes a PspMapperRegistry via getPspRegistry()", () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t" }
    );
    expect(svc.getPspRegistry()).toBeInstanceOf(PspMapperRegistry);
  });

  it("defaults onUnknownPsp to 'warn' on the exposed registry", () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t" }
    );
    expect(svc.getPspRegistry().onUnknownPsp).toBe("warn");
  });

  it("propagates onUnknownPsp from plugin options to the registry", () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t", onUnknownPsp: "error" }
    );
    expect(svc.getPspRegistry().onUnknownPsp).toBe("error");
  });

  it("resolves the built-in Stripe mapper end-to-end through the service", () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t" }
    );
    expect(svc.getPspRegistry().resolve("pp_stripe_stripe")).toBe(stripeMapper);
  });
});

describe("PennylaneModuleService sync options (feature D4)", () => {
  it("getSyncOptions() uses documented defaults when nothing is configured", () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t" }
    );

    expect(svc.getSyncOptions()).toEqual({
      vatMetadataKey: "pennylane_vat_rate",
      defaultShippingVatRate: "FR_200",
      onUnknownPsp: "warn",
      itemUnit: "piece",
      shippingUnit: "forfait",
      metadataSirenKey: "siren",
      metadataVatNumberKey: "vat_number",
    });
  });

  it("getSyncOptions() returns a frozen merged view that picks up overrides", () => {
    const svc = new PennylaneModuleService(
      { logger: silentLogger as never },
      {
        apiToken: "t",
        vatMetadataKey: "custom_vat",
        defaultShippingVatRate: "FR_55",
        itemUnit: "kg",
        onUnknownPsp: "error",
      }
    );

    const opts = svc.getSyncOptions();
    expect(opts.vatMetadataKey).toBe("custom_vat");
    expect(opts.defaultShippingVatRate).toBe("FR_55");
    expect(opts.itemUnit).toBe("kg");
    expect(opts.onUnknownPsp).toBe("error");
    expect(opts.shippingUnit).toBe("forfait"); // untouched default
    expect(Object.isFrozen(opts)).toBe(true);
  });

  it("isAutoSyncOnCaptureEnabled() defaults to true; honors explicit false", () => {
    const svcDefault = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t" }
    );
    expect(svcDefault.isAutoSyncOnCaptureEnabled()).toBe(true);

    const svcOptOut = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t", autoSyncOnCapture: false }
    );
    expect(svcOptOut.isAutoSyncOnCaptureEnabled()).toBe(false);

    const svcExplicit = new PennylaneModuleService(
      { logger: silentLogger as never },
      { apiToken: "t", autoSyncOnCapture: true }
    );
    expect(svcExplicit.isAutoSyncOnCaptureEnabled()).toBe(true);
  });
});
