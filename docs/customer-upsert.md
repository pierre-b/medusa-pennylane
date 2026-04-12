# Customer upsert + billing address (features C1 + C2)

> Two bundled helpers that ensure a Pennylane customer exists — with the right billing identity frozen at sale time — before a paid Medusa order can be turned into an invoice. C2 (`toPennylaneBillingAddress`) is the pure address mapper; C1 (`upsertPennylaneCustomer`) is the async idempotent lookup-or-create.

## Purpose

D1 produces an invoice payload that references a Pennylane `customer_id`. That id has to come from somewhere. C1 looks it up (via `GET /customers?filter=…`) or creates it (via `POST /individual_customers` or `POST /company_customers`) using the billing identity from the order. D3 (the upcoming invoice-sync workflow) composes C1 → D1 → D2.

Both C1 and C2 are **pure-logic** in the sense that neither touches the Medusa container, reads the filesystem, or loads state from our own DB. C1 does take a `PennylaneClient` (an HTTP boundary), but testing mocks its methods via `jest.spyOn`.

## C2 — `toPennylaneBillingAddress(address, orderId)`

```ts
import { toPennylaneBillingAddress } from "medusa-plugin-pennylane/modules/pennylane/customer";

toPennylaneBillingAddress(order.billing_address, order.id);
// →
// {
//   address: "12 rue du Commerce",       // address_1, or "address_1, address_2" when both present
//   postal_code: "75015",
//   city: "Paris",
//   country_alpha2: "FR",                 // uppercased (Medusa stores lowercase)
// }
```

Every required field throws a clear error when missing, empty, or `null` — French invoicing law requires a complete identity on every invoice, and failing loudly at build time beats silently emitting an incomplete invoice. The error always includes the order id so D3's dead-letter log is self-diagnostic.

Pennylane's `address` is a single-line string; `address_1 + ", " + address_2` renders cleanly on the invoice PDF.

## C1 — `upsertPennylaneCustomer(input)`

```ts
import { upsertPennylaneCustomer } from "medusa-plugin-pennylane/modules/pennylane/customer";

const { customerId, externalReference, type, action } =
  await upsertPennylaneCustomer({
    order, // OrderDTO — must have billing_address populated
    client, // PennylaneClient (from service.getClient())
    // Optional:
    externalReferenceOverride: undefined,
    metadataSirenKey: "siren",
    metadataVatNumberKey: "vat_number",
  });
```

### External-reference derivation

| Rule                                 | Resolves to                 |
| ------------------------------------ | --------------------------- |
| `externalReferenceOverride` provided | the override verbatim       |
| `order.customer_id` present          | `"med_cust_" + customer_id` |
| otherwise (guest checkout)           | `"med_order_" + order.id`   |

**Why per-order customers for guests** (not email-clustered): immutability of invoice identity is a French invoicing-law requirement (CGI Art. 289 and BOFIP-TVA). Merging guests by email hash would let a second order silently mutate the first invoice's customer record — forbidden. Each guest order gets a frozen Pennylane customer record. Accountants can consolidate at the account level (e.g., `411000 Clients B2C Divers`) without compromising individual invoice immutability.

### Lookup → create decision

```
GET /customers?filter=[{field:"external_reference",operator:"eq",value:<externalRef>}]&limit=1
  │
  ├─ customers[0] exists  →  return { action: "found", customerId: customers[0].id, type }
  │
  └─ customers[] empty    →  create (individual or company)

Create branch, type selection:
  order.billing_address.company present  →  POST /company_customers
  otherwise                               →  POST /individual_customers
```

### B2C payload (individual)

```ts
{
  first_name,                       // billing_address.first_name (required)
  last_name,                        // billing_address.last_name  (required)
  external_reference,               // the derived reference
  billing_address,                  // from C2
  // Conditionally included:
  emails: [order.email],            // when order.email is a non-empty string
  phone: billing_address.phone,     // when non-empty
}
```

### B2B payload (company)

```ts
{
  name: billing_address.company,    // required (what triggered the B2B branch)
  external_reference,
  billing_address,
  // Conditionally included:
  emails: [order.email],
  phone: billing_address.phone,
  reg_no: order.metadata[metadataSirenKey],       // SIREN, e.g. "123456789"
  vat_number: order.metadata[metadataVatNumberKey], // e.g. "FR12345678"
}
```

`reg_no` and `vat_number` are **optional** on Pennylane's side — omitted from the body when the corresponding metadata key is absent or empty. The plugin does not validate SIREN locally (Luhn checksum is deferred); Pennylane validates server-side.

### Customer data source

**Always** `order.billing_address` — first_name / last_name / company / phone / address. Never `order.customer.*`. Rationale: the billing address is the legally-required invoice identity for THIS sale; updates to the customer's profile after the sale must not retroactively mutate the invoice's buyer. If the same registered customer places a second order with a different billing address, we'll send an UPDATE call (future feature — not shipped here) to reflect the newer address on the Pennylane customer, but the already-issued invoice stays intact.

### Result shape

```ts
interface UpsertPennylaneCustomerResult {
  customerId: number; // Pennylane id, to be plugged into D1's customer_id
  externalReference: string; // for caller bookkeeping (CustomerSync DB row, future)
  type: "individual" | "company";
  action: "found" | "created";
}
```

## HTTP error propagation

C1 does **not** catch HTTP errors from the client. `PennylaneAuthError`, `PennylaneForbiddenError`, `PennylaneValidationError`, `PennylaneServerError`, `PennylaneNetworkError` — all `MedusaError` subclasses — propagate unchanged to the caller. D3 (the workflow) owns the retry / dead-letter policy.

C1's own throws are limited to:

- Input validation — missing `billing_address`, missing `first_name` on the individual branch.
- Defensive response-shape checks — lookup response without a `customers` array, create response without a numeric `id`. These guard against unexpected Pennylane responses with a diagnostic error instead of silently returning garbage.

## Tests

- `src/modules/pennylane/customer/__tests__/address.unit.spec.ts` — 9 tests: every required-field throw, the `address_2` join, the country-code uppercase, the `null` / `undefined` input rejections.
- `src/modules/pennylane/customer/__tests__/upsert.unit.spec.ts` — 23 tests across 5 groups:
  - external_reference derivation (registered / guest / override)
  - lookup path (found / company / empty / filter shape)
  - individual create path (POST endpoint, body shape, emails, phone, return value)
  - company create path (POST endpoint, name, SIREN, VAT, optional field omission)
  - validation + defensive response handling (missing billing_address, missing first_name, empty company heuristic, unexpected lookup shape, non-numeric create id)

Total: 32 new unit tests (test total plugin-wide: 190).

## Composition with the rest of the plugin

```
D3 workflow (future)
  │
  ├─ 1. Get order with relations (items, shipping_methods, billing, payment_collections.payments)
  │
  ├─ 2. Upsert Pennylane customer                     ← this feature
  │       { customerId } = upsertPennylaneCustomer({ order, client: service.getClient() })
  │
  ├─ 3. Pick captured payment from order.payment_collections[]
  │
  ├─ 4. Resolve PSP mapper via service.getPspRegistry().resolve(payment.provider_id)
  │
  ├─ 5. Build invoice payload                          ← D1 (shipped)
  │       { payload } = buildInvoicePayload({ order, customerId, payment, pspMapper, options })
  │
  ├─ 6. POST it via client.post("/customer_invoices", { body: payload })   ← D2 (future)
  │
  └─ 7. Persist InvoiceSync + CustomerSync links       ← D3 (future)
```

## Explicitly out of scope

- **Customer updates** — if a registered customer's profile changes after their first order, we do not push an UPDATE to the Pennylane customer record. The already-issued invoice is frozen by design; a future feature can add a "keep Pennylane customer in sync with Medusa customer" flow.
- **CustomerSync DB persistence** — C1 is stateless w.r.t. our own tables. D3 writes the `customer ↔ pennylane_customer_id` link.
- **Concurrent-create race** — two parallel D3s for the same customer could both miss the lookup and both try to create. Pennylane's response to duplicate `external_reference` on customer creation is undocumented; we accept the low-impact risk.
- **SIREN / VAT local validation** — Luhn checksum on SIREN is not performed. Pennylane validates server-side.
- **Payment conditions per customer** — D1 sets `payment_conditions: "upon_receipt"` at the invoice level.
