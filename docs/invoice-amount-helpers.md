# Invoice amount helpers (features D5 + D6)

> Two pure, dependency-free functions that handle the number-crunching needed before an invoice payload is sent to Pennylane. Both live in `src/modules/pennylane/invoicing/` and are consumed by the upcoming invoice payload builder (D1).

## Why these exist

Pennylane's API expects `raw_currency_unit_price` and `price_before_tax` as decimal strings (`"12.50"`, not `12.50`). Medusa stores amounts as integer minor units (cents for EUR, no minor unit for JPY, fils for KWD). Two jobs fall out of the mismatch:

- **Format conversion (D5):** `1250 → "12.50"` for EUR, `1250 → "1250"` for JPY, `1000 → "1.000"` for KWD.
- **Totals reconciliation (D6):** floating-point and compounding arithmetic can produce a 1-cent mismatch between the sum of line totals and the order total. Pennylane rejects unbalanced invoices, and accountants reject any invoice that doesn't match the charge. We adjust the largest line by the drift before sending.

Both helpers are intentionally **pure functions** with no Medusa runtime dependency. They're trivially unit-testable and trivially reusable.

## D5 — `centsToPennylaneDecimal(amount, currency = "EUR")`

```ts
import { centsToPennylaneDecimal } from "medusa-plugin-pennylane/modules/pennylane/invoicing";

centsToPennylaneDecimal(1250); // "12.50"  (defaults to EUR)
centsToPennylaneDecimal(1250, "USD"); // "12.50"
centsToPennylaneDecimal(1250, "JPY"); // "1250"   (zero-decimal currency)
centsToPennylaneDecimal(1000, "KWD"); // "1.000"  (three-decimal currency)
centsToPennylaneDecimal(-500, "EUR"); // "-5.00"  (credit notes)
centsToPennylaneDecimal(1250.333); // "12.503330"  (fractional cents → 6 decimals)
```

**Contract.**

- `amount` is a `number` in **minor currency units**. For zero-decimal currencies (JPY, KRW, …) this means the integer major-unit amount — JPY has no smaller unit. This matches how Medusa's `BigNumber` utility stores amounts.
- `currency` is an ISO 4217 code, case-insensitive. Unknown codes default to 2 decimals.
- Integer input → exactly `getCurrencyDecimals(currency)` fraction digits.
- Fractional input (produced by D6's largest-line adjustment) → 6 fraction digits, Pennylane's documented maximum on `raw_currency_unit_price`. Exception: zero-decimal currencies (JPY, KRW, …) have no minor unit, so fractional inputs are rounded back to the integer major unit rather than emitted as nonsensical `"1250.500000"`.
- Throws on `NaN` / `Infinity`.

Companion: `getCurrencyDecimals(currency)` returns the decimal count (0, 2, or 3). Exported for callers that need the raw value.

### ISO 4217 decimals table

Encoded as two module-private `Set`s:

- **0 decimals:** BIF, CLP, DJF, GNF, ISK, JPY, KMF, KRW, PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF
- **3 decimals:** BHD, IQD, JOD, KWD, LYD, OMR, TND
- **Everything else:** 2 decimals (including EUR, USD, GBP, CHF, CAD, AUD, CNY, INR, …)

## D6 — `reconcileInvoiceLineTotals(lines, expectedTotalCents)`

```ts
import { reconcileInvoiceLineTotals } from "medusa-plugin-pennylane/modules/pennylane/invoicing";

const lines = [
  { quantity: 2, unitPriceCents: 850, label: "Tablet", vat_rate: "FR_55" },
  { quantity: 1, unitPriceCents: 2417, label: "Box", vat_rate: "FR_200" },
  { quantity: 1, unitPriceCents: 492, label: "Ship", vat_rate: "FR_200" },
];
// sum = 4609 cents; order total says 4610 cents → drift +1
const balanced = reconcileInvoiceLineTotals(lines, 4610);
// balanced[1].unitPriceCents === 2418  (largest line absorbed +1 cent)
// other fields (label, vat_rate) preserved unchanged
```

**Contract.**

- `lines` — an array of `{quantity, unitPriceCents, …extras}`. Extras pass through untouched thanks to the generic signature `<T extends ReconcilableInvoiceLine>(readonly T[], number) => T[]`.
- `expectedTotalCents` — the authoritative order total in minor units.
- If `sum(line.quantity × line.unitPriceCents) === expectedTotalCents` already: returns the input reference-equal.
- If drift ∈ {-1, +1}: adjusts the largest line's `unitPriceCents` by `drift / quantity`. Fractional cents allowed (Pennylane accepts up to 6 decimals).
- Ties on largest total resolve deterministically to the first occurrence.
- Throws when:
  - `|drift| > 1` — a rounding artifact should never exceed one cent; a bigger delta is a logic bug.
  - `expectedTotalCents` is not finite.
  - `lines` is empty and `expectedTotalCents` ≠ 0.
- Never mutates the input array or its element objects. Returns a new array with the adjusted line replaced by a fresh object; untouched lines share references with the input.
- Return type is `readonly T[]` so the pure-function contract is enforced at the type level. Callers that need a mutable array can `.slice()` or spread.

### The fractional-cent caveat

When the largest line has `quantity > 1`, a 1-cent drift becomes a `1/quantity` fractional-cent adjustment on the unit price. `centsToPennylaneDecimal` will format it with 6 decimals, which Pennylane's spec supports.

**Open question:** does Pennylane compute `round(unitPrice × quantity, 2)` at full precision, or `round(unitPrice, 2) × quantity` (pre-rounded)? The OpenAPI spec doesn't document this. If Pennylane pre-rounds, our fractional-cent adjustment is silently lost and the invoice total is off by one cent.

**D2's live smoke test** must validate by sending an invoice with a fractional-cent line and confirming the returned `currency_amount` matches our expectation. If it doesn't, D6's strategy switches to "prefer largest quantity-1 line" (99% of real e-commerce invoices have one). This is tracked as a D2 implementation-time risk, not a D5/D6 blocker.

## Composition with D1

D1 (upcoming) will do roughly:

```ts
import {
  centsToPennylaneDecimal,
  reconcileInvoiceLineTotals,
} from "./invoicing";

function buildInvoicePayload(order, mapper, options) {
  // 1. Build raw lines from the Medusa order
  const rawLines = order.items.map((item) => ({
    label: item.title,
    quantity: item.quantity,
    unitPriceCents: toCents(item.unit_price), // BigNumber unwrap
    vat_rate: item.metadata[options.vatMetadataKey],
  }));

  // 2. Reconcile to the order total
  const balanced = reconcileInvoiceLineTotals(rawLines, toCents(order.total));

  // 3. Format each for Pennylane
  return {
    // ... other fields
    invoice_lines: balanced.map((line) => ({
      label: line.label,
      quantity: line.quantity,
      raw_currency_unit_price: centsToPennylaneDecimal(
        line.unitPriceCents,
        order.currency_code
      ),
      unit: "piece",
      vat_rate: line.vat_rate,
    })),
  };
}
```

## Tests

- `src/modules/pennylane/invoicing/__tests__/amounts.unit.spec.ts` — 17 tests covering every currency class (0/2/3-decimal), fractional cents, negative amounts, case normalization, NaN/Infinity rejection, default currency.
- `src/modules/pennylane/invoicing/__tests__/reconcile.unit.spec.ts` — 13 tests covering zero-drift identity, ±1-cent adjustments, fractional distribution on quantity > 1, tie-breaking, drift-cap rejection, empty-lines handling, non-finite validation, immutability, and pass-through field preservation.

## Explicitly out of scope

- **BigNumber unwrapping.** Medusa's `BigNumberValue` conversion to integer cents happens in D1, not here.
- **VAT breakdown reconciliation.** Pennylane computes tax server-side from the lines we send; we only balance HT totals.
- **Adjustment-line strategy.** Locked as "largest-line" in the plan. Future feature may surface a `roundingStrategy` option if a host needs it.
- **Drift tolerance > 1 cent.** Locked at 1; H1 or a follow-up feature may make it configurable.
