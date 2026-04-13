import type { OrderDTO, PaymentDTO } from "@medusajs/framework/types";

import { stripeMapper } from "../../psp/stripe-mapper";
import {
  buildInvoicePayload,
  type BuildInvoicePayloadOptions,
} from "../invoice-payload";

/* ------------------------------------------------------------------------ */
/* Fixture builders                                                         */
/* ------------------------------------------------------------------------ */

type ItemInput = {
  id?: string;
  title?: string;
  product_title?: string | null;
  quantity?: number;
  total?: number; // TTC post-discount (in major units)
  tax_total?: number;
  vat_rate?: string | null | number;
  metadata?: Record<string, unknown> | null;
};

const item = (overrides: ItemInput = {}) => ({
  id: overrides.id ?? "item_1",
  title: overrides.title ?? "Chocolate Tablet",
  product_title:
    overrides.product_title ?? overrides.title ?? "Chocolate Tablet",
  quantity: overrides.quantity ?? 1,
  unit_price: 0, // ignored by the new formula; kept for type compat
  raw_unit_price: { value: "0" },
  is_tax_inclusive: false,
  total: overrides.total ?? 10,
  tax_total: overrides.tax_total ?? 0,
  subtotal: 0,
  tax_lines: [],
  metadata:
    overrides.metadata !== undefined
      ? overrides.metadata
      : { pennylane_vat_rate: overrides.vat_rate ?? "FR_200" },
});

const shipping = (
  overrides: {
    id?: string;
    name?: string;
    total?: number;
    tax_total?: number;
  } = {}
) => ({
  id: overrides.id ?? "ship_1",
  name: overrides.name ?? "Colissimo",
  amount: 0,
  is_tax_inclusive: false,
  subtotal: 0,
  total: overrides.total ?? 0,
  tax_total: overrides.tax_total ?? 0,
  tax_lines: [],
});

type OrderOverrides = {
  id?: string;
  display_id?: number;
  currency_code?: string;
  created_at?: string;
  items?: ReturnType<typeof item>[];
  shipping_methods?: ReturnType<typeof shipping>[];
};

const makeOrder = (overrides: OrderOverrides = {}): OrderDTO =>
  ({
    id: overrides.id ?? "order_01JABC",
    display_id: overrides.display_id ?? 42,
    currency_code: overrides.currency_code ?? "eur",
    created_at: overrides.created_at ?? "2026-04-12T10:00:00.000Z",
    items: overrides.items ?? [item()],
    shipping_methods: overrides.shipping_methods ?? [],
  }) as unknown as OrderDTO;

const makePayment = (
  provider_id: string,
  data: Record<string, unknown> = { id: "pi_3AbC123" }
): PaymentDTO =>
  ({
    id: "pay_1",
    amount: 0,
    currency_code: "eur",
    provider_id,
    data,
  }) as unknown as PaymentDTO;

const baseOptions = (
  over: Partial<BuildInvoicePayloadOptions> = {}
): BuildInvoicePayloadOptions => ({
  vatMetadataKey: "pennylane_vat_rate",
  defaultShippingVatRate: "FR_200",
  onUnknownPsp: "warn",
  ...over,
});

const stripePayment = makePayment("pp_stripe_stripe");

/* ------------------------------------------------------------------------ */
/* Groups                                                                   */
/* ------------------------------------------------------------------------ */

describe("buildInvoicePayload — scaffolding + happy path (Group A)", () => {
  it("throws when the order has no items", () => {
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({ items: [] }),
        customerId: 1,
        payment: null,
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/no items/i);
  });

  it("builds a complete payload for a single-item order with Stripe payment", () => {
    const { payload, warnings } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ total: 10, tax_total: 0, vat_rate: "FR_55" })],
      }),
      customerId: 7,
      payment: stripePayment,
      pspMapper: stripeMapper,
      options: baseOptions(),
    });

    expect(payload.customer_id).toBe(7);
    expect(payload.external_reference).toBe("42");
    expect(payload.invoice_lines).toHaveLength(1);
    expect(payload.invoice_lines[0].vat_rate).toBe("FR_55");
    expect(payload.transaction_reference).toEqual({
      banking_provider: "stripe",
      provider_field_name: "payment_id",
      provider_field_value: "pi_3AbC123",
    });
    expect(warnings).toEqual([]);
  });

  it("normalizes lowercase currency code to uppercase in the output", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({ currency_code: "eur" }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.currency).toBe("EUR");
  });
});

describe("buildInvoicePayload — items HT extraction (Group B)", () => {
  it("handles HT-exclusive order (no tax)", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ quantity: 2, total: 10, tax_total: 0 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    // HT line = 10, quantity 2 → HT/unit = 5 EUR = "5.00"
    expect(payload.invoice_lines[0].raw_currency_unit_price).toBe("5.00");
  });

  it("handles HT-exclusive order with 20% VAT", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ quantity: 2, total: 12, tax_total: 2 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    // HT line = 10, HT/unit = 5 EUR
    expect(payload.invoice_lines[0].raw_currency_unit_price).toBe("5.00");
  });

  it("handles tax-inclusive order with 20% VAT (formula is inclusive-agnostic)", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ quantity: 2, total: 24, tax_total: 4 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    // HT line = 20, HT/unit = 10 EUR
    expect(payload.invoice_lines[0].raw_currency_unit_price).toBe("10.00");
  });

  it("preserves item input order in invoice_lines", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [
          item({ id: "a", title: "A", total: 10 }),
          item({ id: "b", title: "B", total: 20 }),
          item({ id: "c", title: "C", total: 30 }),
        ],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines.map((l) => l.label)).toEqual(["A", "B", "C"]);
  });

  it("falls back to product_title then to 'Item <id>' when title is falsy", () => {
    const build = (titleOverride: {
      title?: string;
      product_title?: string | null;
    }) =>
      buildInvoicePayload({
        order: makeOrder({
          items: [item({ id: "item_xyz", total: 10, ...titleOverride })],
        }),
        customerId: 1,
        payment: null,
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "accept" }),
      }).payload.invoice_lines[0].label;

    expect(build({ title: "", product_title: "Product X" })).toBe("Product X");
    expect(build({ title: "", product_title: null })).toBe("Item item_xyz");
  });
});

describe("buildInvoicePayload — VAT metadata + item validation (Group C)", () => {
  it("throws when item.metadata is missing", () => {
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({
          items: [item({ id: "item_42", title: "Product X", metadata: null })],
        }),
        customerId: 1,
        payment: null,
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/item_42.*pennylane_vat_rate/i);
  });

  it("throws when the VAT key is missing from metadata", () => {
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({
          items: [
            item({ id: "item_x", title: "Y", metadata: { other: "value" } }),
          ],
        }),
        customerId: 1,
        payment: null,
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/pennylane_vat_rate/i);
  });

  it("throws when the VAT value is not a non-empty string", () => {
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({
          items: [item({ id: "item_x", vat_rate: 123 as unknown as string })],
        }),
        customerId: 1,
        payment: null,
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/vat/i);
  });

  it("throws when item.quantity is zero", () => {
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({
          items: [item({ id: "item_0", quantity: 0 })],
        }),
        customerId: 1,
        payment: null,
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/quantity/i);
  });
});

describe("buildInvoicePayload — shipping lines (Group D)", () => {
  it("appends a shipping line when total > 0", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ total: 10 })],
        shipping_methods: [shipping({ name: "UPS", total: 6, tax_total: 1 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines).toHaveLength(2);
    const shippingLine = payload.invoice_lines[1];
    expect(shippingLine.label).toBe("UPS");
    expect(shippingLine.quantity).toBe(1);
    expect(shippingLine.unit).toBe("forfait");
    expect(shippingLine.vat_rate).toBe("FR_200");
    // HT = 6 - 1 = 5 EUR
    expect(shippingLine.raw_currency_unit_price).toBe("5.00");
  });

  it("skips shipping when total == 0 (free shipping)", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ total: 10 })],
        shipping_methods: [shipping({ total: 0 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines).toHaveLength(1);
  });

  it("appends multiple shipping methods in source order", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ total: 10 })],
        shipping_methods: [
          shipping({ name: "Alpha", total: 5 }),
          shipping({ name: "Beta", total: 3 }),
        ],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines.slice(-2).map((l) => l.label)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("uses 'Livraison' when shipping_method.name is missing", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ total: 10 })],
        shipping_methods: [shipping({ name: "", total: 5 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines[1].label).toBe("Livraison");
  });
});

describe("buildInvoicePayload — fractional-cent lines (Group E)", () => {
  it("outputs integer-cent unit price for clean divisions", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ quantity: 1, total: 10, tax_total: 0 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines[0].raw_currency_unit_price).toBe("10.00");
  });

  it("uses 6-decimal precision when the per-unit division produces fractional cents", () => {
    // htLineCents = toMinorUnits(10.01, "EUR") = 1001
    // quantity = 3 → unitPriceCents = 1001 / 3 = 333.666…
    // centsToPennylaneDecimal formats fractional cents with 6 decimals:
    //   (333.666… / 100).toFixed(6) = "3.336667"
    // Pennylane then computes 3.336667 × 3 = 10.010001 → rounds to 10.01.
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ quantity: 3, total: 10.01, tax_total: 0 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines[0].raw_currency_unit_price).toBe("3.336667");
  });
});

describe("buildInvoicePayload — BigNumberValue end-to-end integration (Group E2)", () => {
  it("unwraps IBigNumber-shaped totals through the full pipeline", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [
          {
            ...item({ quantity: 1 }),
            // simulate Medusa v2 IBigNumber shape
            total: { numeric: 10.01 } as unknown as number,
            tax_total: { numeric: 0 } as unknown as number,
          },
        ],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines[0].raw_currency_unit_price).toBe("10.01");
  });

  it("unwraps BigNumber-shaped totals via .toNumber()", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        items: [
          {
            ...item({ quantity: 2 }),
            total: { toNumber: () => 20 } as unknown as number,
            tax_total: { toNumber: () => 0 } as unknown as number,
          },
        ],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines[0].raw_currency_unit_price).toBe("10.00");
  });
});

describe("buildInvoicePayload — display_id guard", () => {
  it("throws when display_id is missing", () => {
    expect(() =>
      buildInvoicePayload({
        order: {
          ...makeOrder({ items: [item({ total: 10 })] }),
          display_id: undefined,
        } as unknown as Parameters<typeof buildInvoicePayload>[0]["order"],
        customerId: 1,
        payment: null,
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/display_id/);
  });
});

describe("buildInvoicePayload — PSP mapper + onUnknownPsp (Group F)", () => {
  it("includes transaction_reference when both payment and mapper resolve", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({ items: [item({ total: 10 })] }),
      customerId: 1,
      payment: stripePayment,
      pspMapper: stripeMapper,
      options: baseOptions(),
    });
    expect(payload.transaction_reference).toBeDefined();
  });

  it("onUnknownPsp='warn' emits payload without transaction_reference and records a warning", () => {
    const { payload, warnings } = buildInvoicePayload({
      order: makeOrder({ items: [item({ total: 10 })] }),
      customerId: 1,
      payment: makePayment("pp_unknown_foo"),
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "warn" }),
    });
    expect(payload.transaction_reference).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/pp_unknown_foo/);
  });

  it("onUnknownPsp='accept' stays silent", () => {
    const { payload, warnings } = buildInvoicePayload({
      order: makeOrder({ items: [item({ total: 10 })] }),
      customerId: 1,
      payment: makePayment("pp_unknown_foo"),
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.transaction_reference).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("onUnknownPsp='error' throws with provider id and order id", () => {
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({
          id: "order_xyz",
          items: [item({ total: 10 })],
        }),
        customerId: 1,
        payment: makePayment("pp_unknown_foo"),
        pspMapper: null,
        options: baseOptions({ onUnknownPsp: "error" }),
      })
    ).toThrow(/order_xyz.*pp_unknown_foo/i);
  });

  it("payment=null with 'warn' emits without transaction_reference and warns about 'none'", () => {
    const { warnings } = buildInvoicePayload({
      order: makeOrder({ items: [item({ total: 10 })] }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "warn" }),
    });
    expect(warnings[0]).toMatch(/none/i);
  });

  it("mapper returns null (missing data.id) → falls through to onUnknownPsp policy", () => {
    const { payload, warnings } = buildInvoicePayload({
      order: makeOrder({ items: [item({ total: 10 })] }),
      customerId: 1,
      payment: makePayment("pp_stripe_stripe", {}),
      pspMapper: stripeMapper,
      options: baseOptions({ onUnknownPsp: "warn" }),
    });
    expect(payload.transaction_reference).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("buildInvoicePayload — fractional quantity warning", () => {
  it("warns when quantity is fractional and unit is the default 'piece'", () => {
    const { payload, warnings } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ id: "weight_item", quantity: 1.5, total: 15 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.invoice_lines[0].quantity).toBe(1.5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/weight_item/);
    expect(warnings[0]).toMatch(/fractional/i);
  });

  it("does not warn when the caller overrides itemUnit (e.g., 'kg')", () => {
    const { warnings } = buildInvoicePayload({
      order: makeOrder({
        items: [item({ quantity: 1.5, total: 15 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept", itemUnit: "kg" }),
    });
    expect(warnings).toEqual([]);
  });

  it("does not warn for integer quantity with default unit", () => {
    const { warnings } = buildInvoicePayload({
      order: makeOrder({ items: [item({ quantity: 2, total: 20 })] }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(warnings).toEqual([]);
  });
});

describe("buildInvoicePayload — TransactionReference validation", () => {
  it("throws when a custom mapper returns a ref with missing fields", () => {
    const malformedMapper = {
      id: "malformed",
      matches: () => true,
      toTransactionReference: () => ({
        banking_provider: "ok",
        provider_field_name: "",
        provider_field_value: "value",
      }),
    };
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({
          id: "order_broken",
          items: [item({ total: 10 })],
        }),
        customerId: 1,
        payment: makePayment("pp_custom"),
        pspMapper: malformedMapper,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/malformed.*provider_field_name/);
  });

  it("throws naming the offending field when a non-string is returned", () => {
    const malformedMapper = {
      id: "bad-types",
      matches: () => true,
      toTransactionReference: () => ({
        banking_provider: "x",
        provider_field_name: "y",
        provider_field_value: 42 as unknown as string,
      }),
    };
    expect(() =>
      buildInvoicePayload({
        order: makeOrder({ items: [item({ total: 10 })] }),
        customerId: 1,
        payment: makePayment("pp_custom"),
        pspMapper: malformedMapper,
        options: baseOptions({ onUnknownPsp: "accept" }),
      })
    ).toThrow(/provider_field_value/);
  });
});

describe("buildInvoicePayload — label", () => {
  it("sets label to a human-readable 'Medusa order #<display_id>' form", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        display_id: 1234,
        items: [item({ total: 10 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.label).toBe("Medusa order #1234");
  });
});

describe("buildInvoicePayload — output assembly (Group G)", () => {
  it("date equals deadline (same day, already-paid invoice)", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({
        created_at: "2026-04-12T08:30:00.000Z",
        items: [item({ total: 10 })],
      }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.date).toBe("2026-04-12");
    expect(payload.deadline).toBe("2026-04-12");
  });

  it("draft is always false", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({ items: [item({ total: 10 })] }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.draft).toBe(false);
  });

  it("external_reference is String(order.display_id)", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({ display_id: 12345, items: [item({ total: 10 })] }),
      customerId: 1,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.external_reference).toBe("12345");
  });

  it("customer_id passes through from input", () => {
    const { payload } = buildInvoicePayload({
      order: makeOrder({ items: [item({ total: 10 })] }),
      customerId: 987,
      payment: null,
      pspMapper: null,
      options: baseOptions({ onUnknownPsp: "accept" }),
    });
    expect(payload.customer_id).toBe(987);
  });
});
