# Invoice payload builder (feature D1)

> Pure function that turns a Medusa v2 `OrderDTO` + a caller-selected payment + a caller-resolved PSP mapper into the JSON body Pennylane's `POST /customer_invoices` (Finalized branch) accepts. Composes every invoicing helper shipped so far — D5 (decimal formatting), D6 (line reconciliation), P1/P2 (PSP registry + Stripe mapper), and A4/A5 (VAT enum).

## Purpose

D1 is the heart of the order → Pennylane flow. It's the step where we commit to a concrete API payload. It:

- Extracts HT (pre-tax) line amounts from a Medusa order whatever the pricing convention (tax-inclusive or not, discounted or not).
- Builds Pennylane invoice lines with the right label, quantity, formatted unit price, unit, and VAT code.
- Emits a shipping line per non-zero shipping method.
- Reconciles line totals against the self-consistent expected sum (D6), catches logic bugs with a 1-cent drift cap.
- Resolves the `transaction_reference` block through the caller's PSP mapper, or applies the `onUnknownPsp` policy when no mapper fires.
- Returns `{ payload, warnings }` so the caller decides whether to log.

D1 is **pure** — no I/O, no container, no mutation. Everything it needs is in the input; any non-fatal observation goes into the returned `warnings` array. D3 (the invoice-sync workflow, not yet shipped) is expected to be the primary consumer.

## Public API

```ts
import { buildInvoicePayload } from "medusa-plugin-pennylane/modules/pennylane/invoicing";

const { payload, warnings } = buildInvoicePayload({
  order, // OrderDTO with items[] and shipping_methods[] populated
  customerId: 42, // Pennylane customer id (resolved by C1, passed by D3)
  payment, // PaymentDTO | null — caller picks the captured payment
  pspMapper, // PspMapper | null — caller resolves via registry
  options: {
    vatMetadataKey: "pennylane_vat_rate",
    defaultShippingVatRate: "FR_200",
    onUnknownPsp: "warn",
  },
});
```

### Input

| Field                            | Type                            | Notes                                                                                                                                            |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `order`                          | `OrderDTO`                      | Must have `items[]` populated. `shipping_methods[]` optional. `created_at` drives the invoice `date`. `display_id` becomes `external_reference`. |
| `customerId`                     | `number`                        | Pennylane customer id. Not resolved here — D3 handles C1 upsert first.                                                                           |
| `payment`                        | `PaymentDTO \| null`            | Caller selects the captured payment from `order.payment_collections[].payments`. `null` when the order has no captured payment yet.              |
| `pspMapper`                      | `PspMapper \| null`             | Already resolved by the caller from the registry. `null` when no catalogue entry matched.                                                        |
| `options.vatMetadataKey`         | `string`                        | Key under `item.metadata` that holds the Pennylane VAT code (e.g., `"pennylane_vat_rate"`).                                                      |
| `options.defaultShippingVatRate` | `string`                        | VAT code for every shipping line (typically `"FR_200"`).                                                                                         |
| `options.onUnknownPsp`           | `"warn" \| "accept" \| "error"` | Policy when no mapper resolves — see PSP docs.                                                                                                   |
| `options.itemUnit`               | `string` (optional)             | Defaults to `"piece"`.                                                                                                                           |
| `options.shippingUnit`           | `string` (optional)             | Defaults to `"forfait"`.                                                                                                                         |

### Output

```ts
interface BuildInvoicePayloadOutput {
  payload: {
    date: string; // YYYY-MM-DD from order.created_at
    deadline: string; // = date (invoice is already paid)
    customer_id: number;
    external_reference: string; // String(order.display_id)
    currency: string; // uppercase ISO 4217
    draft: false;
    label: string; // "Medusa order #<display_id>" — internal Pennylane-side label
    payment_conditions: "upon_receipt"; // invoice is already paid
    transaction_reference?: {
      // omitted when no mapper resolves
      banking_provider: string;
      provider_field_name: string;
      provider_field_value: string;
    };
    invoice_lines: Array<{
      label: string;
      quantity: number;
      raw_currency_unit_price: string;
      unit: string;
      vat_rate: string;
    }>;
  };
  warnings: string[]; // non-fatal events
}
```

**Warnings** cover two non-fatal situations:

1. `onUnknownPsp: "warn"` fires and no PSP mapper resolves — invoice emitted without `transaction_reference`.
2. An item has fractional `quantity` with the default `itemUnit: "piece"` — the invoice line reads e.g. `"1.5 pieces"` which is accounting-weird. Configure `options.itemUnit = "kg"` (or appropriate) if the host sells weight-based products.

## HT extraction (the critical correctness question)

Medusa line items carry both a tax-inclusive and a tax-exclusive representation. The `is_tax_inclusive` boolean flips how `unit_price` should be interpreted, and stacked `tax_lines[]` can complicate the derivation further. **D1 sidesteps all of it** using a single formula that works in every case:

```
HT per line  = item.total − item.tax_total    // both BigNumberValue → unwrap
HT per unit  = HT per line / item.quantity
```

- `item.total` is always the post-discount, post-tax (TTC) line amount — that's what was actually charged.
- `item.tax_total` is always the computed tax on the line (sum across stacked tax rates if any).
- Their difference is always the post-discount HT line amount, regardless of `is_tax_inclusive` or discount shape.

The same formula applies to `shipping_method.total − shipping_method.tax_total` for shipping lines.

`toMinorUnits` converts the HT major units (`10.50`) to the integer cents D6/D5 operate on (`1050`). Round-trip back through `centsToPennylaneDecimal` gives the Pennylane-shaped `"10.50"` string.

## VAT metadata contract

Every line item **must** carry the VAT code at `item.metadata[options.vatMetadataKey]`. If the key is missing, the metadata object is absent, or the value is not a non-empty string, D1 throws with a message naming the order id, the item id, and the product title. No silent fallback — French VAT correctness is load-bearing.

The metadata is copied from the product to the line item by Medusa at order creation; operators set it once per product in the admin.

## `onUnknownPsp` policy

The registry resolution lives in D3 (the consumer). D1 just takes the `PspMapper | null` result and applies the policy:

| `payment` | `pspMapper` | mapper returns             | `onUnknownPsp` | Outcome                                   |
| --------- | ----------- | -------------------------- | -------------- | ----------------------------------------- |
| present   | present     | ref                        | any            | `payload.transaction_reference` set       |
| present   | present     | `null` (missing `data.id`) | `"warn"`       | omitted, warning added                    |
| present   | present     | `null`                     | `"accept"`     | omitted, silent                           |
| present   | present     | `null`                     | `"error"`      | throw                                     |
| present   | `null`      | —                          | `"warn"`       | omitted, warning naming the provider      |
| `null`    | `null`      | —                          | `"warn"`       | omitted, warning saying `provider "none"` |
| —         | —           | —                          | `"error"`      | throw (always, when no ref produced)      |

Warnings contain the provider id + order id so operators can correlate log lines.

## Per-unit precision (no D6 reconciliation)

D1 computes each line's HT total in integer cents (`htLineCents = toMinorUnits(item.total − item.tax_total, currency)`) and divides by `quantity` to get `unitPriceCents` — fractional when the division leaves a remainder. `centsToPennylaneDecimal` then formats fractional cents with 6 decimals (Pennylane's `raw_currency_unit_price` cap), so `unit_price × quantity` on Pennylane's side reproduces `htLineCents` exactly.

**D1 does NOT call `reconcileInvoiceLineTotals`.** D6 was designed to absorb drift between two truly independent calculations; in D1 both `expected` and `actual` would be derived from the same `(total − tax_total)` source, so reconciliation would be performative (always-zero drift) — worse, would mask the per-unit rounding error that fractional cents actually fix. D6 remains available in the module's public surface and will be useful for future features that have an independent truth (e.g., E-series credit notes reconciled against the refund amount).

Example: a 3-for-10.01 EUR line produces `htLineCents = 1001`, `unitPriceCents = 333.666…`, formatted as `"3.336667"`. Pennylane evaluates `3.336667 × 3 = 10.010001`, rounds the invoice total to `10.01` — exact match to what the customer paid.

## Worked example

```ts
const order = {
  id: "order_01JR...",
  display_id: 42,
  currency_code: "eur",
  created_at: "2026-04-12T10:00:00.000Z",
  items: [
    {
      id: "item_a",
      title: "Tablette Chocolat Noir 70%",
      quantity: 2,
      total: 17.94,        // TTC after tax
      tax_total: 0.94,     // 5.5% of 17 HT
      metadata: { pennylane_vat_rate: "FR_55" },
    },
    {
      id: "item_b",
      title: "Coffret Truffes Assorties",
      quantity: 1,
      total: 29.00,
      tax_total: 4.83,     // 20% of 24.17 HT
      metadata: { pennylane_vat_rate: "FR_200" },
    },
  ],
  shipping_methods: [
    {
      id: "ship_1",
      name: "Colissimo",
      total: 5.90,
      tax_total: 0.98,     // 20% VAT
    },
  ],
};

// buildInvoicePayload produces approximately:
{
  payload: {
    date: "2026-04-12",
    deadline: "2026-04-12",
    customer_id: 42,
    external_reference: "42",
    currency: "EUR",
    draft: false,
    transaction_reference: {
      banking_provider: "stripe",
      provider_field_name: "payment_id",
      provider_field_value: "pi_3AbC...",
    },
    invoice_lines: [
      { label: "Tablette Chocolat Noir 70%", quantity: 2, raw_currency_unit_price: "8.50", unit: "piece", vat_rate: "FR_55" },
      { label: "Coffret Truffes Assorties", quantity: 1, raw_currency_unit_price: "24.17", unit: "piece", vat_rate: "FR_200" },
      { label: "Colissimo", quantity: 1, raw_currency_unit_price: "4.92", unit: "forfait", vat_rate: "FR_200" },
    ],
  },
  warnings: [],
}
```

## Composition with the rest of the plugin

```
order.payment_captured (Medusa event, future D4 subscriber)
        │
        ▼
D3 workflow (future):
  1. Fetch order with relations (items, shipping, payment_collections.payments)
  2. Upsert Pennylane customer                                    ← C1 (future)
  3. Pick captured payment from order.payment_collections[]
  4. Resolve PSP mapper:                                          ← P1 (shipped)
       mapper = service.getPspRegistry().resolve(payment.provider_id)
  5. Build payload:                                               ← D1 (this feature)
       { payload, warnings } = buildInvoicePayload({ order, customerId, payment, pspMapper, options })
  6. POST it via PennylaneClient                                  ← A1 (shipped), D2 (future)
  7. Persist InvoiceSync link                                     ← B1 (shipped)
  8. Log warnings
```

## Tests

- `src/modules/pennylane/invoicing/__tests__/invoice-payload.unit.spec.ts` — 29 tests covering every branch: no-items throw, HT extraction across tax-inclusive + tax-exclusive + discount shapes, VAT metadata validation (missing, wrong type, quantity-zero), shipping (present / zero-skip / multi / nameless), PSP mapper with every `onUnknownPsp` setting, output assembly (date, draft, external_reference, customer_id).
- `src/modules/pennylane/invoicing/__tests__/big-number.unit.spec.ts` — 5 tests covering `unwrapBigNumber` across every `BigNumberValue` shape plus NaN/Infinity/malformed rejection.
- `src/modules/pennylane/invoicing/__tests__/amounts.unit.spec.ts` gains 5 `toMinorUnits` tests.

39 new tests total; plugin-wide total: 109 → 148.

## Explicitly out of scope

- **D3 workflow step** — fetch the order, pick the payment, resolve the mapper, run D1, then call D2 and persist.
- **D2 API call** — the step that actually `POST`s the payload and handles Pennylane errors / retries.
- **D4 subscriber** on `order.payment_captured`.
- **Refund / credit-note payload** — different flow; E series.
- **Per-item `unit` override** — v1 uses the `options.itemUnit` default for every line. Products with unit = `"kg"` will need a future feature (e.g., `item.metadata.pennylane_unit`).
- **Discount lines** — Medusa bakes discounts into `total`, so the HT extraction already accounts for them. No separate invoice line needed.
- **PDF branding fields** — `pdf_invoice_subject`, `pdf_description` are Pennylane-supported but not emitted; future feature.
- **Multi-currency orders** — `currency_code` is uniform per order. D1 works for every currency D5 supports.
