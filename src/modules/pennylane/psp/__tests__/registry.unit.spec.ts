import type { PaymentDTO } from "@medusajs/framework/types";

import type { PspMapper, TransactionReference } from "../mapper";
import { PspMapperRegistry } from "../registry";
import { stripeMapper } from "../stripe-mapper";

const makeFakeMapper = (overrides: Partial<PspMapper> = {}): PspMapper => ({
  id: "fake",
  matches: (providerId) => providerId === "pp_fake",
  toTransactionReference: () => ({
    banking_provider: "fake",
    provider_field_name: "ref",
    provider_field_value: "x",
  }),
  ...overrides,
});

describe("PspMapperRegistry construction and defaults", () => {
  it("defaults onUnknownPsp to 'warn'", () => {
    const registry = new PspMapperRegistry();
    expect(registry.onUnknownPsp).toBe("warn");
  });

  it("stores an explicit onUnknownPsp", () => {
    const registry = new PspMapperRegistry({ onUnknownPsp: "error" });
    expect(registry.onUnknownPsp).toBe("error");
  });

  it("throws when onUnknownPsp has an invalid value", () => {
    expect(
      () =>
        new PspMapperRegistry({
          onUnknownPsp: "panic" as unknown as "warn",
        })
    ).toThrow(/onUnknownPsp/);
  });

  it("resolves a built-in mapper with empty options", () => {
    const registry = new PspMapperRegistry();
    expect(registry.resolve("pp_stripe_stripe")).toBe(stripeMapper);
  });
});

describe("PspMapperRegistry resolution order", () => {
  it("returns the built-in Stripe mapper for a Stripe provider id", () => {
    const registry = new PspMapperRegistry();
    expect(registry.resolve("pp_stripe_stripe")).toBe(stripeMapper);
  });

  it("returns null when no built-in, no alias, and no custom mapper matches", () => {
    const registry = new PspMapperRegistry();
    expect(registry.resolve("pp_system_default")).toBeNull();
  });

  it("resolves via providerAliases before any matching", () => {
    const registry = new PspMapperRegistry({
      providerAliases: { pp_my_fork: "stripe" },
    });
    expect(registry.resolve("pp_my_fork")).toBe(stripeMapper);
  });

  it("falls back to custom mappers when no built-in matches", () => {
    const customMapper = makeFakeMapper();
    const registry = new PspMapperRegistry({ customMappers: [customMapper] });
    expect(registry.resolve("pp_fake")).toBe(customMapper);
  });

  it("prefers built-ins over custom mappers (custom is last resort)", () => {
    const colliding = makeFakeMapper({
      id: "custom-stripe",
      matches: (providerId) => providerId === "pp_stripe_stripe",
    });
    const registry = new PspMapperRegistry({
      customMappers: [colliding],
    });
    expect(registry.resolve("pp_stripe_stripe")).toBe(stripeMapper);
  });
});

describe("PspMapperRegistry disables and validation", () => {
  it("drops disabled built-ins from resolution", () => {
    const registry = new PspMapperRegistry({ disableMappers: ["stripe"] });
    expect(registry.resolve("pp_stripe_stripe")).toBeNull();
  });

  it("throws when disableMappers contains a typo / unknown id", () => {
    expect(() => new PspMapperRegistry({ disableMappers: ["strip"] })).toThrow(
      /disableMappers/
    );
  });

  it("throws when a providerAliases target does not exist", () => {
    expect(
      () =>
        new PspMapperRegistry({
          providerAliases: { pp_x: "nonexistent" },
        })
    ).toThrow(/providerAliases/);
  });

  it("throws when a providerAliases target is disabled", () => {
    expect(
      () =>
        new PspMapperRegistry({
          providerAliases: { pp_x: "stripe" },
          disableMappers: ["stripe"],
        })
    ).toThrow(/providerAliases/);
  });

  it("throws when a custom mapper id collides with a non-disabled built-in", () => {
    const shadow = makeFakeMapper({ id: "stripe" });
    expect(() => new PspMapperRegistry({ customMappers: [shadow] })).toThrow(
      /disableMappers/
    );
  });

  it("allows a custom mapper to reuse a built-in id when that built-in is disabled", () => {
    const replacement = makeFakeMapper({
      id: "stripe",
      matches: (providerId) => providerId === "pp_custom_stripe",
    });
    const registry = new PspMapperRegistry({
      disableMappers: ["stripe"],
      customMappers: [replacement],
    });
    expect(registry.resolve("pp_custom_stripe")).toBe(replacement);
  });

  it("throws when a custom mapper is malformed (missing required methods)", () => {
    const malformed = { id: "x" } as unknown as PspMapper;
    expect(() => new PspMapperRegistry({ customMappers: [malformed] })).toThrow(
      /customMappers/
    );
  });

  it("tolerates a mapper that throws at resolve time (error surfaces to caller)", () => {
    const broken = makeFakeMapper({
      id: "broken",
      matches: (providerId) => providerId === "pp_broken",
      toTransactionReference: () => {
        throw new Error("mapper boom");
      },
    });
    const registry = new PspMapperRegistry({ customMappers: [broken] });
    const resolved = registry.resolve("pp_broken");
    expect(resolved).toBe(broken);
    expect(() =>
      resolved!.toTransactionReference({} as unknown as PaymentDTO)
    ).toThrow("mapper boom");
    // Registry does not wrap — caller (D2) owns exception policy.
    const _sink: TransactionReference | null = null;
    expect(_sink).toBeNull();
  });
});
