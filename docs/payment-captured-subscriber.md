# `payment.captured` subscriber (feature D4)

> Medusa v2 subscriber that auto-triggers Pennylane invoice creation on every captured payment. Walks from the payment to its order via module links, then invokes `syncOrderToPennylaneWorkflow` (D3).

## Purpose

D4 is the point where the order → Pennylane pipeline runs itself. An operator configures the plugin once in `medusa-config.ts`; from then on, every captured payment in the host store produces a finalized Pennylane invoice without manual triggering. No more hand-syncing orders; no forgotten invoices.

D4 also binds the D3 `options` to `PennylaneModuleOptions` so hosts configure sync behavior once instead of at every call site. D3 itself stays option-agnostic (caller-provided); D4 is the canonical caller that reads from module options.

## Event

Medusa v2 emits `payment.captured` after `capturePaymentWorkflow`, `processPaymentWorkflow`, or `markPaymentCollectionAsPaid` completes successfully. The payload is the payment id:

```ts
{
  id: string;
} // the payment id — NOT the order id
```

The subscriber resolves `paymentId → orderId` via Medusa's module links before invoking D3.

## Handler flow

```
1. If auto-sync is disabled (options.autoSyncOnCapture === false):
     log "auto-sync disabled" → return

2. Look up the payment + its linked order:
     query.graph({
       entity: "payment",
       fields: ["id", "payment_collection.order.id"],
       filters: { id: paymentId },
     })
   On throw → log ERROR, return (never rethrow)

3. Extract orderId = payment.payment_collection.order.id
   If missing (standalone payment, wallet top-up, POS ad-hoc) →
     log DEBUG "no order linked; skipping" → return

4. Invoke syncOrderToPennylaneWorkflow with {order_id, options}
   On throw → log ERROR, return
   On success → done
```

The handler **never throws**. Medusa v2 subscribers are fire-and-forget: a thrown error is logged but does not trigger automatic retry. Re-throwing just clutters the event log without benefit. Durable failure state lives in `InvoiceSync` (persisted by D3); admin re-sync (G1, future) is the recovery path.

## Architecture — two layers

Same split as D3. The Layer 1 file is a pure async helper with plain deps; the Layer 2 file is a thin Medusa subscriber that resolves the container and delegates.

- `src/subscribers/handle-payment-captured.ts` — pure handler. Tested exhaustively with mocked deps.
- `src/subscribers/payment-captured.ts` — Medusa subscriber (default export + `config`). Resolves `query`, `logger`, and the `pennylane` service from the container.

## Configuration

All options are optional with sensible defaults. In `medusa-config.ts`:

```ts
modules: [
  {
    resolve: "medusa-plugin-pennylane",
    options: {
      apiToken: process.env.PENNYLANE_API_TOKEN,

      // Auto-sync on capture (default: true)
      autoSyncOnCapture: true,

      // D3 sync options — defaults documented here
      vatMetadataKey: "pennylane_vat_rate",
      defaultShippingVatRate: "FR_200",
      itemUnit: "piece",
      shippingUnit: "forfait",
      metadataSirenKey: "siren",
      metadataVatNumberKey: "vat_number",

      // PSP registry (existing)
      onUnknownPsp: "warn",
    },
  },
],
```

Service accessors (used by D4, available to custom callers):

- `service.isAutoSyncOnCaptureEnabled(): boolean`
- `service.getSyncOptions(): SyncOrderToPennylaneOptions` — returns a frozen object.

## Opt-out

Set `autoSyncOnCapture: false`. The subscriber file is still loaded by Medusa at boot — Medusa v2 doesn't support conditional subscriber registration without a loader — but the handler early-returns on opt-out. Overhead: one `container.resolve` + one boolean check per capture event. Negligible.

Useful for staging environments that shouldn't emit invoices, or for hosts that want to trigger sync from a different source (admin button, scheduled job).

## Known limitations

- **At-least-once delivery**: Medusa v2's Redis event bus replays `payment.captured` on network hiccups. Idempotency lives in D3 (DB unique on `medusa_order_id` + D2's remote pre-check on `external_reference`). D4 itself has no dedup — it calls D3 on every event.
- **Fire-and-forget errors**: if Pennylane's API is down when a capture event fires and D3 throws, that event is lost for D4's purposes. D3 still persists `InvoiceSync.status = "failed"` with the error, so recovery is possible via the admin re-sync button (G1) or a future reconcile job. No automatic retry happens from D4.
- **Read-replica staleness**: under a primary/replica DB topology, `query.graph` could briefly return `undefined` for an order that exists on the primary. Single-node Medusa deployments are unaffected. Mitigation (if you scale to replicas): route the subscriber's first read to the primary, or add a bounded retry on missing order.
- **Orphan payments** (wallet top-ups, POS ad-hoc captures, standalone `PaymentCollection` without an order link): skipped silently at DEBUG. Not an error — Medusa supports these flows and they're out of the invoicing scope.

## Composition

```
payment.captured  (Medusa v2 event)
        │
        ▼
pennylanePaymentCapturedHandler   (src/subscribers/payment-captured.ts)
        │
        ▼
handlePaymentCaptured            (pure helper — unit-tested)
        ├─ query.graph(payment → order)
        ├─ if no order → debug skip
        └─ syncOrderToPennylaneWorkflow.run({order_id, options})
              │
              ▼
          D3 orchestrator → C1 + D1 + D2 → InvoiceSync
```

## Tests

- `src/subscribers/__tests__/handle-payment-captured.unit.spec.ts` — 6 tests across opt-out, happy path, missing-collection, missing-order, query throw, workflow throw.
- `src/modules/pennylane/__tests__/service.unit.spec.ts` (3 tests added for D4) — `getSyncOptions()` defaults + overrides + freeze; `isAutoSyncOnCaptureEnabled()`.

**Subscriber-level test**: deferred — the Layer 2 file is thin glue, fully covered by Layer 1's unit tests. When the plugin-boot harness lands (alongside B4 migrations), an integration test can fire a real `payment.captured` event end-to-end.

## Explicitly out of scope

- **`pennylane.sync_failed` custom event** — future DLQ hook; G1 + ops patterns.
- **Bounded retry on missing order** (replica staleness mitigation) — single-node hosts don't need it; future hardening.
- **Admin re-sync button** (G1) — future; will reuse the same workflow.
- **Bulk reconcile job** — future; for recovering from sustained Pennylane outages.
