# Order → Pennylane sync workflow (feature D3)

> End-to-end glue that makes a Medusa order become a finalized, auto-reconciled Pennylane invoice. Composes C1 (customer upsert), D1 (payload builder), and D2 (invoice POST) into one orchestrated flow and persists the result in the `InvoiceSync` table.

## Purpose

D3 is the first feature that performs work you can point at an order and watch happen: "sync this order, please." Given a Medusa order id, it:

1. Fetches the order with the relations D1 needs (items, shipping methods, billing address, payment collections).
2. Picks the captured payment (if any) and resolves its PSP mapper.
3. Upserts the Pennylane customer (C1).
4. Builds the Pennylane invoice payload (D1).
5. Posts it with an idempotent pre-check (D2).
6. Persists the outcome in `InvoiceSync`: `status: "synced"` + `pennylane_invoice_id` on success, `status: "failed"` + `last_error` on failure.

D3 is **invoked** by the caller — there is no automatic triggering yet. The follow-up feature D4 wires a subscriber on `order.payment_captured`; the admin widget (G1) will add a manual "re-sync" button against the same workflow.

## Architecture — two layers

Splitting the feature into a pure async orchestrator and a thin Medusa workflow wrapper means 90% of the behavior is covered by fast unit tests against mocked deps; the workflow DSL layer is ~15 lines of glue.

### Layer 1 — the orchestrator

```ts
import { syncOrderToPennylane } from "medusa-plugin-pennylane/modules/pennylane/invoicing";

const result = await syncOrderToPennylane({
  order, // OrderDetailDTO fetched with relations
  client, // PennylaneClient (usually service.getClient())
  pspRegistry, // PspMapperRegistry (usually service.getPspRegistry())
  invoiceSyncs, // InvoiceSyncRepo (structural slice of PennylaneModuleService)
  options: {
    vatMetadataKey: "pennylane_vat_rate",
    defaultShippingVatRate: "FR_200",
    onUnknownPsp: "warn",
  },
});
```

**Result**:

```ts
interface SyncOrderToPennylaneResult {
  invoiceSyncId: string;
  pennylaneInvoiceId: number;
  pennylaneCustomerId: number | null; // null on already-synced short-circuit
  externalReference: string;
  action: "created" | "idempotent" | "already-synced";
  warnings: string[];
}
```

Three `action` values:

- `"created"` — a new invoice was POSTed.
- `"idempotent"` — D2's pre-check found an existing Pennylane invoice with the same `external_reference`; its id was returned without POSTing.
- `"already-synced"` — the local `InvoiceSync` row was already in `status: "synced"` with a populated `pennylane_invoice_id`; the orchestrator returned that id without any API call.

### Layer 2 — `pickCapturedPayment`

Small helper that walks `order.payment_collections[].payments[]` and returns the first payment where `captured_at` is truthy and `canceled_at` is falsy. Returns `null` otherwise.

D3 is the first code path in the plugin to consume `captured_at` / `canceled_at`. Medusa's `PaymentDTO` exposes both as optional `string | Date`; the helper treats any truthy value as "captured" and any truthy `canceled_at` as a disqualifier.

### Layer 3 — the Medusa workflow

```ts
import { syncOrderToPennylaneWorkflow } from "medusa-plugin-pennylane/workflows/sync-order-to-pennylane";

const { result } = await syncOrderToPennylaneWorkflow(container).run({
  input: {
    order_id: "order_01JR...",
    options: {
      vatMetadataKey: "pennylane_vat_rate",
      defaultShippingVatRate: "FR_200",
      onUnknownPsp: "warn",
    },
  },
});
```

Two workflow steps:

1. `useQueryGraphStep` — fetches the order with `billing_address.*`, `items.*`, `items.metadata`, `shipping_methods.*`, `payment_collections.*`, `payment_collections.payments.*`. `throwIfKeyNotFound: true` so a missing order surfaces loudly.
2. `runSyncStep` — resolves the `pennylane` module, calls `syncOrderToPennylane` with the fetched order.

**No compensation**. Pennylane invoices are immutable after finalization; customers are normally permanent. The orchestrator itself persists the `"failed"` state before rethrowing, so the caller has a record without needing to roll anything back.

## Idempotency contract

Two independent guards, deliberately redundant:

1. **DB unique index on `InvoiceSync.medusa_order_id`** — already shipped in the model. Two concurrent runs racing to insert the initial row: one wins, one gets a unique-violation error which propagates as a D3 failure.
2. **D2's remote pre-check on `external_reference`** — catches the case where a previous run POSTed the invoice but crashed before updating the DB row. On re-run, D2 finds the existing Pennylane invoice and returns it with `action: "idempotent"` instead of creating a duplicate.

Both guards matter:

- The DB row alone proves "we believed we synced this", but a crash between D2's POST and the DB update leaves an orphan Pennylane invoice without a local row.
- The Pennylane pre-check alone would let concurrent runs both succeed in creating Pennylane-side duplicates if they raced past the pre-check.

## Failure handling

On any exception after the `InvoiceSync` row is transitioned to `"syncing"`:

```
await invoiceSyncs.updateInvoiceSyncs({
  id: invoiceSyncId,
  status: "failed",
  last_error: formatError(err),
});
throw err;
```

`formatError` serializes `${err.name}: ${err.message}` for `Error` instances (or `String(err)` for non-Error throws), truncated to 1000 characters. No stack traces, no request/response payloads — those would risk PII leakage and a bloated text column.

The original error is rethrown unchanged. The typed HTTP errors from `PennylaneClient` (`PennylaneValidationError`, `PennylaneServerError`, `PennylaneAuthError`, etc.) reach the workflow caller with their types intact, so a future retry or dead-letter policy can branch on error class.

## Retry semantics

Calling D3 a second time for the same order:

- If the existing row is `status: "synced"` with a non-null `pennylane_invoice_id` → short-circuit return `action: "already-synced"`. No API calls.
- If the existing row is `status: "failed"` or `status: "syncing"` → re-enter the flow. The row is first updated back to `status: "syncing"` with `last_error` cleared, then the full C1 → D1 → D2 sequence runs again. D2's remote pre-check handles the case where the previous attempt did create a Pennylane invoice.

## Known limitations

- **Concurrent D3 runs on the same order**: two D3 calls racing for the same order both see an empty `listInvoiceSyncs` lookup; both attempt `createInvoiceSyncs`. The DB unique index on `medusa_order_id` rejects the loser with a unique-violation. D4 subscribers don't race with themselves (Medusa serializes per-handler), but an admin "re-sync" button could race with D4. The winning call's outcome governs the DB row; the loser's error surfaces to its caller.
- **No migration shipped yet**: the `InvoiceSync` and `CustomerSync` tables are defined in the model but no migration has been generated. Running D3 against a real database requires roadmap item B4 (run `medusa db:generate pennylane`). D3's unit tests mock the service CRUD methods so they validate the orchestration logic without needing migrations.
- **`captured_at` / `canceled_at` semantics**: D3 uses Medusa's canonical "captured" signal (`captured_at` truthy, `canceled_at` falsy). It does **not** consult `captured_amount` or `refunded_amount` — refunds are the E-series feature's concern (credit notes).
- **`options.vatMetadataKey` / `defaultShippingVatRate`**: the caller passes these explicitly. Binding them to `PennylaneModuleOptions` is deferred to D4, which knows how to read module options when it resolves the service.

## Composition

```
order.payment_captured  (future D4 subscriber)
        │
        ▼
syncOrderToPennylaneWorkflow
  ├─ useQueryGraphStep (order with relations)
  └─ runSyncStep
       └─ syncOrderToPennylane (pure orchestrator)
            ├─ listInvoiceSyncs → short-circuit or upsert syncing row
            ├─ pickCapturedPayment (D3 helper)
            ├─ pspRegistry.resolve (P1)
            ├─ upsertPennylaneCustomer (C1)
            ├─ buildInvoicePayload (D1)
            ├─ createPennylaneInvoice (D2)
            └─ updateInvoiceSyncs (synced / failed)
```

## Tests

- `src/modules/pennylane/invoicing/__tests__/pick-payment.unit.spec.ts` — 5 tests covering the empty / first-match / no-match / captured-then-canceled cases.
- `src/modules/pennylane/invoicing/__tests__/sync-order.unit.spec.ts` — 10 tests across happy path (fresh / already-synced / D2-idempotent), retry paths (failed / syncing), failure paths (C1 / D2 / D1 throws, `last_error` truncation), and D1-warnings passthrough.

**Workflow-level test**: deferred until the plugin-boot harness lands and B4 ships migrations. The workflow is thin glue; its behavior is covered by the orchestrator's unit tests.

## Explicitly out of scope

- **B4 migration** — separate feature; D3 ships test-green against mocked service CRUD.
- **D4 subscriber** on `order.payment_captured` — next feature.
- **Admin re-sync button** (G1) — future; will invoke this workflow.
- **Retry / rate-limit policy** — future A2 + A3 wrap the client; D3 rethrows unchanged.
- **Module options binding** for `vatMetadataKey` etc. — deferred to D4.
- **PDF URL / invoice_number surfacing** — D2's minimal return shape stands; callers that need these can GET `/customer_invoices/{id}` separately.
