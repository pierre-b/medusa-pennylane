# Invoice creation (feature D2)

> Thin async helper that POSTs the D1 payload to Pennylane's `POST /customer_invoices` with an idempotent pre-check on `external_reference`. Returns the created (or already-existing) invoice id.

## Purpose

D2 is the step that actually commits the invoice to Pennylane. D1 produces the payload, D2 sends it. D2 guarantees that re-running the same operation with the same `external_reference` never produces duplicate invoices: before POSTing, it asks Pennylane `GET /customer_invoices?filter=[{field:"external_reference",operator:"eq",value:…}]&limit=1`, and if a match exists it returns that invoice id with `action: "idempotent"` instead of creating a new one.

This pre-check is **belt-and-suspenders** with the future D3 workflow's local `InvoiceSync` DB check. Both layers matter because:

- The DB row proves "we believed we already synced this order," but a crash between the Pennylane POST and the DB insert would leave an orphan Pennylane invoice without a local row.
- The Pennylane pre-check proves "Pennylane actually has an invoice for this external_reference" regardless of our local state.

One extra GET per sync is cheap; duplicate invoices in French accounting are not.

## Public API

```ts
import { createPennylaneInvoice } from "medusa-plugin-pennylane/modules/pennylane/invoicing";

const { invoiceId, externalReference, action } = await createPennylaneInvoice({
  payload, // the PennylaneInvoiceCreatePayload produced by buildInvoicePayload (D1)
  client, // the PennylaneClient — usually obtained via `service.getClient()`
  orderId, // Medusa order id — used only for diagnostic messages
});
```

### Input

| Field     | Type                            | Notes                                                                                                                                           |
| --------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `payload` | `PennylaneInvoiceCreatePayload` | The D1 output. Its `external_reference` field drives both the idempotent lookup and the POST body. `draft: false` targets the Finalized branch. |
| `client`  | `PennylaneClient`               | The A1 HTTP client. D2 calls `client.get("/customer_invoices", …)` then, if no match, `client.post("/customer_invoices", …)`.                   |
| `orderId` | `string`                        | Medusa order id, only used in thrown error messages so operators can correlate failures with the source order.                                  |

### Output

```ts
interface CreatePennylaneInvoiceResult {
  invoiceId: number;
  externalReference: string;
  action: "created" | "idempotent";
}
```

- `action: "created"` — no existing invoice matched; a new one was POSTed.
- `action: "idempotent"` — an invoice with the same `external_reference` already existed in Pennylane; no POST happened and the pre-existing `invoiceId` is returned.

## Algorithm

```
1.  externalReference := payload.external_reference
2.  GET /customer_invoices
      ?filter=[{"field":"external_reference","operator":"eq","value":<externalRef>}]
      &limit=1
    → if items[0] exists and has numeric id:
          return { invoiceId: items[0].id, externalReference, action: "idempotent" }
3.  POST /customer_invoices with body = payload
    → return { invoiceId: response.id, externalReference, action: "created" }
```

Both responses are shape-validated:

- Lookup: `response.items` must be an array; if a match is returned, `items[0].id` must be a number. Anything else throws a diagnostic error naming the order id.
- Create: `response.id` must be a number. Otherwise throw.

These defensive checks catch spec drift or a misconfigured reverse proxy early, with a message that points at the root cause — rather than surfacing as a cryptic downstream error.

## Error propagation

D2 does **not** catch the A1 typed errors (`PennylaneAuthError`, `PennylaneForbiddenError`, `PennylaneNotFoundError`, `PennylaneValidationError`, `PennylaneServerError`, `PennylaneNetworkError`). Any HTTP-level failure propagates unchanged to the caller. The D3 workflow (not yet shipped) owns retry, dead-letter, and observability for those errors.

The errors D2 itself throws are all shape-validation errors (items-not-array, non-numeric id): plain `Error` instances with enough context to identify the offending order.

## Why `external_reference` is safe for idempotency

Pennylane treats `external_reference` as a unique key per tenant. D1 sets it to `String(order.display_id)`, which is immutable for a Medusa order. The filter endpoint only supports `operator: "eq"` for `external_reference` (see the [spec fixture](../src/modules/pennylane/client/__fixtures__/openapi-customer-invoices-list.json)), so there is no ambiguity about what "already exists" means.

## Composition with the rest of the plugin

```
order.payment_captured (Medusa event, future D4 subscriber)
        │
        ▼
D3 workflow (future):
  1. Fetch order with items, shipping, payment_collections.payments
  2. Upsert Pennylane customer                                    ← C1 (shipped)
  3. Pick the captured payment from order.payment_collections[]
  4. Resolve PSP mapper:                                          ← P1 (shipped)
       mapper = service.getPspRegistry().resolve(payment.provider_id)
  5. Build payload:                                               ← D1 (shipped)
       { payload, warnings } = buildInvoicePayload({...})
  6. POST it:                                                     ← D2 (this feature)
       { invoiceId, action } = await createPennylaneInvoice({ payload, client, orderId })
  7. Persist InvoiceSync link                                     ← B1 (shipped)
  8. Log warnings + action
```

## Tests

`src/modules/pennylane/invoicing/__tests__/create-invoice.unit.spec.ts` — 10 tests:

- **Group A — idempotent path (4)**: lookup-hit returns `action: "idempotent"` without POST; empty `items[]` falls through to create; filter encoding is the exact JSON-array the spec requires; non-numeric found `id` throws.
- **Group B — create path (4)**: successful POST returns `action: "created"`; POST body is the exact payload (no mutation); non-numeric response `id` throws with a diagnostic; typed client errors (e.g. 422) propagate unchanged.
- **Group C — shape validation + passthrough (2)**: missing `items` array throws a diagnostic; `externalReference` is propagated from `payload.external_reference` to the result.

## Explicitly out of scope

- **D3 workflow** — fetch the order, resolve customer + PSP, build payload, call D2, persist `InvoiceSync`.
- **D4 subscriber** on `order.payment_captured`.
- **PDF URL / invoice_number surfacing** — the minimal return shape is intentional. Callers that need these fields can GET `/customer_invoices/{id}` separately.
- **Retry / rate-limit** — propagates client errors; future A2 + A3 wrap the client.
- **Draft invoices** — D2 targets the Finalized branch via D1's `draft: false` payload. Draft flow is out of scope.
- **Updating an existing invoice** — Pennylane invoices are immutable after finalization. Corrections go via credit notes (E series).
