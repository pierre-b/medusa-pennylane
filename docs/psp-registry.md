# PSP mapper registry (features P1 + P2)

> Lazy registry of Payment Service Provider mappers. Ships a catalogue of known mappers (Stripe in v1) and resolves a Medusa `payment.provider_id` to the correct Pennylane `transaction_reference` shape on demand. Used by feature D2 when building finalized invoices.

## Purpose

Pennylane's auto-reconciliation works by matching invoices against imported bank transactions. On the Finalized branch of `POST /customer_invoices`, the plugin attaches a `transaction_reference` block whose three fields (`banking_provider`, `provider_field_name`, `provider_field_value`) are PSP-specific. Different PSPs (Stripe, Mollie, PayPal…) need different values.

Rather than hard-coding Stripe, the plugin is **PSP-agnostic**: a registry resolves `payment.provider_id` → `PspMapper` at runtime, and the mapper builds the `transaction_reference`. Hosts that use PSPs already in the catalogue need zero configuration. Hosts that use custom PSPs can supply their own mappers via plugin options.

## Architecture

```
Medusa payment captured
        │
        ▼
Workflow step (D2) calls:
  mapper = service.getPspRegistry().resolve(payment.provider_id)
  ├── if mapper:
  │     tx_ref = mapper.toTransactionReference(payment)
  │     → invoice includes transaction_reference in the request body
  │
  └── if null:
        apply onUnknownPsp policy:
          "warn"   → log warning, emit invoice without tx_ref
          "accept" → silent, emit invoice without tx_ref
          "error"  → fail the workflow (caller retries or dead-letters)
```

The registry itself is **policy-free** — it stores the `onUnknownPsp` value but does not act on it. D2 reads the value and decides.

## Plugin options

| Option            | Type                            | Default  | Notes                                                                                           |
| ----------------- | ------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `onUnknownPsp`    | `"warn" \| "accept" \| "error"` | `"warn"` | Policy when no mapper resolves. The registry stores; D2 enforces.                               |
| `providerAliases` | `Record<string, string>`        | `{}`     | Map a custom `provider_id` to a mapper's `id`. Example: `{ "pp_my_fork_of_stripe": "stripe" }`. |
| `disableMappers`  | `string[]`                      | `[]`     | Disable built-in mappers by id. Example: `["stripe"]`.                                          |
| `customMappers`   | `PspMapper[]`                   | `[]`     | User-supplied mappers. Last-resort fallback; to override a built-in, disable it first.          |

All four options validate at boot. Invalid values throw with a message naming the offending option.

## Built-in catalogue (v1)

| id       | `matches` pattern                   | `banking_provider` | `provider_field_name` | `provider_field_value` source                     |
| -------- | ----------------------------------- | ------------------ | --------------------- | ------------------------------------------------- |
| `stripe` | `pp_stripe_*` (base + all variants) | `"stripe"`         | `"payment_id"`        | `payment.data.id` (Stripe PaymentIntent `pi_...`) |

Future catalogue entries (Mollie, PayPal, Klarna, Adyen) ship as individual features once a host needs them.

## Resolution order

The registry's `resolve(providerId)` returns the first match from:

1. **Alias lookup.** `providerAliases[providerId]` → mapper whose `id` equals the alias target (searched across built-ins-minus-disabled + custom). Aliases short-circuit normal matching.
2. **Built-in catalogue.** First built-in (minus disabled) whose `matches(providerId)` returns `true`.
3. **Custom mappers.** First custom mapper whose `matches(providerId)` returns `true`. Custom is the **last resort** — to replace a built-in, disable it via `disableMappers` and add your replacement to `customMappers`.
4. Otherwise `null`.

## `PspMapper` interface

```ts
import type { PaymentDTO, RefundDTO } from "@medusajs/framework/types";

export interface TransactionReference {
  banking_provider: string;
  provider_field_name: string;
  provider_field_value: string;
}

export interface PspMapper {
  readonly id: string; // used in disableMappers / providerAliases targets
  matches(providerId: string): boolean;
  toTransactionReference(payment: PaymentDTO): TransactionReference | null; // null when data is incomplete
  toRefundTransactionReference?(
    payment: PaymentDTO,
    refund: RefundDTO
  ): TransactionReference | null;
}
```

A mapper may return `null` when the payment is in an indeterminate state (e.g., webhook hasn't fired, `payment.data.id` is missing). This is treated identically to an unknown PSP — the `onUnknownPsp` policy fires.

## Writing a custom mapper

Example: a Mollie mapper. `medusa-config.ts`:

```ts
import type { PspMapper } from "medusa-plugin-pennylane/modules/pennylane/psp";

const mollieMapper: PspMapper = {
  id: "mollie",
  matches: (providerId) => providerId.startsWith("pp_mollie_"),
  toTransactionReference(payment) {
    const pid = (payment.data as { id?: unknown })?.id;
    if (typeof pid !== "string") return null;
    return {
      banking_provider: "mollie",
      provider_field_name: "payment_id",
      provider_field_value: pid,
    };
  },
};

export default defineConfig({
  plugins: [
    {
      resolve: "medusa-plugin-pennylane",
      options: {
        apiToken: process.env.PENNYLANE_API_TOKEN,
        customMappers: [mollieMapper],
      },
    },
  ],
});
```

Every custom mapper is validated at boot (id non-empty string, `matches` + `toTransactionReference` are functions, id unique across the effective catalogue).

## Common overrides

| Scenario                                                            | Options                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| My PSP is already in the catalogue but I use a custom `provider_id` | `providerAliases: { "pp_my_id": "stripe" }`                                       |
| I want to replace the built-in Stripe mapper with my own            | `disableMappers: ["stripe"], customMappers: [myStripeReplacement]`                |
| I want to opt out of Stripe reconciliation entirely                 | `disableMappers: ["stripe"]` (then `onUnknownPsp` takes over for Stripe payments) |
| I want strict failure on any unmapped PSP                           | `onUnknownPsp: "error"`                                                           |

## Error messages (all boot-time)

- `PspMapperRegistry: invalid onUnknownPsp value "panic"; expected one of ["warn","accept","error"]`
- `PspMapperRegistry: disableMappers references unknown mapper id "strip"; built-in catalogue ids are ["stripe"]`
- `PspMapperRegistry: providerAliases["pp_x"] points to "nonexistent", which is not a known mapper id (effective catalogue: [...])`
- `PspMapperRegistry: customMappers id "stripe" collides with an active built-in mapper. To replace the built-in, add disableMappers: ["stripe"].`
- `PspMapperRegistry: customMappers[0] (id="x") is missing a matches function.`

## Explicitly out of scope

- **Boot-time auto-detection.** The registry does not call `paymentModuleService.listPaymentProviders()` at startup; that would require a loader + workflow since Medusa modules cannot directly inject each other (isolation constraint). Deferred to a future feature (P3).
- **Log recap at boot** (`✓ pp_stripe_stripe → stripe mapper / ⚠ pp_system → no mapper`). Depends on auto-detection.
- **`onUnknownPsp` enforcement.** Tested in D2's spec, not here. The registry only stores the value.
- **Non-Stripe catalogue entries.** Mollie, PayPal, Klarna, Adyen — each ships as its own feature when needed.

## Tests

- `src/modules/pennylane/psp/__tests__/stripe-mapper.unit.spec.ts` — 14 tests covering the Stripe mapper's `matches`, `toTransactionReference`, and `toRefundTransactionReference` across every input shape documented in ADR-005.
- `src/modules/pennylane/psp/__tests__/registry.unit.spec.ts` — 16 tests covering construction defaults, resolution order (aliases > built-ins > custom), and every boot-time validation.
- `src/modules/pennylane/__tests__/service.unit.spec.ts` — 4 additional tests asserting the registry is wired into the module service and plugin options flow through.
