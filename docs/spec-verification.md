# Pennylane spec verification (feature A4)

This document captures the authoritative decisions made after mechanically verifying the Pennylane OpenAPI spec at `https://pennylane.readme.io/openapi/accounting.json`. Every downstream feature (C, D, E, F, P) depends on these decisions — do not change a decision without updating the referenced fixture in the same commit.

## Source of truth

- Upstream spec: `https://pennylane.readme.io/openapi/accounting.json` (OpenAPI 3.0.1)
- Committed excerpts: [`src/modules/pennylane/client/__fixtures__/`](../src/modules/pennylane/client/__fixtures__/)
- Snapshot date: **2026-04-12**

## ADR-001 — VAT enum: `FR_55`, not `FR_055`

**Spec path:** `paths./api/external/v2/customer_invoices.post.requestBody.content."application/json".schema.anyOf[1].properties.invoice_lines.items.oneOf[1].properties.vat_rate.enum`

The feasibility doc at `chocolaterie/medusa/docs/pennylane-integration.md` used `FR_055` (with a leading zero) for the 5.5% reduced French rate. The spec uses `FR_55`. Invoices submitted with `FR_055` would be rejected.

**Decision.** `PENNYLANE_VAT_RATES` ships the 20 French codes + 8 special statuses the plugin's target audience needs, typed as a narrow union. Country-specific codes (AT, BE, DE, ES, …) remain pass-through strings for v1.

**Fixture:** [`openapi-vat-rates.json`](../src/modules/pennylane/client/__fixtures__/openapi-vat-rates.json)

**Impact.** Drift is caught by `vat-rate.unit.spec.ts` which compares `PENNYLANE_VAT_RATES` against the fixture in both directions.

## ADR-002 — `GET /customers` filter: JSON array in a query string

**Spec path:** `paths./api/external/v2/customers.get.parameters[2]`

```
GET /api/external/v2/customers?filter=[{"field":"external_reference","operator":"eq","value":"med_cust_01JR..."}]
```

The whole `filter=` value is a URL-encoded JSON array. Operators supported on `external_reference`: `start_with`, `eq`, `not_eq`, `in`, `not_in`.

**Decision.** Feature C1 builds the filter with `encodeURIComponent(JSON.stringify([...]))`. The plugin uses `eq` for single-record dedup lookups.

**Fixture:** [`openapi-customers-list.json`](../src/modules/pennylane/client/__fixtures__/openapi-customers-list.json)

## ADR-003 — Credit notes: two-step flow, no body flag

**Spec path searched:** all `paths./api/external/v2/customer_invoices/*`

`POST /customer_invoices` does **not** accept `credit_note: true` — the feasibility doc was wrong about this. The only credit-note endpoint under `/customer_invoices` is `POST /customer_invoices/{id}/link_credit_note` with a body of `{ "credit_note_id": <int64> }`.

**Decision.** Refund → credit note is two steps:

1. **Create** the credit note via the Pennylane credit-note creation endpoint — pinning down the exact URL is deferred to feature E1 (outside this A4 fixture set).
2. **Link** the credit note to the original invoice via `POST /customer_invoices/{original_id}/link_credit_note` with the new credit-note id.

**Fixture:** [`openapi-customer-invoices-link-credit-note.json`](../src/modules/pennylane/client/__fixtures__/openapi-customer-invoices-link-credit-note.json) — covers the link step only.

## ADR-004 — Pagination: cursor-based only

**Spec paths:** `paths./api/external/v2/customers.get.parameters[0-1]` and parallel on `/customer_invoices`, `/products`, `/transactions`

- Parameters: `cursor` (opaque string, `metadata.cursor` on the previous response), `limit` (1-100, default 20).
- **Page-based pagination (`page`, `per_page`) does not exist on any target endpoint.**
- `use_2026_api_changes=true` is the default (query parameter or `X-Use-2026-API-Changes` header). Plugin does not set this explicitly — inherits the default.

**Decision.** Future pagination helpers (not part of A4) will be cursor-only. Features F2 (bulk product sync), admin resync, and any listing UI follow suit.

**Fixture:** [`openapi-customers-list.json`](../src/modules/pennylane/client/__fixtures__/openapi-customers-list.json) documents the cursor pattern.

## ADR-005 — `transaction_reference` IS a request field on finalized invoices

**Spec path:** `paths./api/external/v2/customer_invoices.post.requestBody.content."application/json".schema.anyOf[1].properties.transaction_reference`

`POST /customer_invoices` uses `anyOf` with two branches:

- Branch 0 — **Draft Customer Invoice**: `draft: true` required; `transaction_reference` not accepted.
- Branch 1 — **Finalized Customer Invoice**: `transaction_reference` accepted (and required to auto-reconcile with a connected PSP).

An earlier exploration only inspected branch 0 and missed the field. The feasibility doc's updated PSP architecture (see ADR-006) is correct: the plugin emits `transaction_reference` on invoice creation.

Required sub-fields: `banking_provider`, `provider_field_name`, `provider_field_value` — all strings, **no enum at the spec level**. Pennylane matches against connected integrations server-side.

**Decision.** Features D1/D2 include a `transaction_reference` block in the `POST /customer_invoices` body whenever a PSP mapper resolves (see ADR-006). No separate `POST /matched_transactions` call on the happy path.

**Fixture:** [`openapi-customer-invoices-create.json`](../src/modules/pennylane/client/__fixtures__/openapi-customer-invoices-create.json) — both branches documented with an explicit `hasTransactionReference` flag.

## ADR-006 — PSP mapper registry becomes part of the plugin core

The feasibility doc's updated architecture specifies a **PSP-agnostic plugin** that ships a catalogue of known mappers with auto-detection at boot:

- `PspMapperRegistry` enumerates payment providers registered in the Medusa container and matches them against the catalogue (regex patterns).
- `options.providerAliases`, `options.disableMappers`, `options.customMappers` let consumers override the defaults.
- `options.onUnknownPsp` (`"warn"` (default) | `"accept"` | `"error"`) controls behavior when no mapper resolves.
- A mapper's `toTransactionReference(payment)` returns the `{ banking_provider, provider_field_name, provider_field_value }` triplet or `null` (which is treated as unknown-PSP).
- v1 catalogue: one entry, `^pp_stripe` → `stripeMapper` (`banking_provider: "stripe"`, `provider_field_name: "payment_id"`, value extracted from `payment.data.id`).

**Decision.** The registry + first mapper are separate features tracked in `ROADMAP.md` as **P. PSP mappers** (P1 registry + P2 Stripe). They land before D1/D2 because the invoice-payload builder must resolve the mapper for every order.

A4 does not implement the registry. It only reserves the roadmap slot.

## Non-decisions

These are things the spec did **not** tell us, recorded here so future feature planning doesn't re-litigate them.

| Topic                                   | Spec says                                                                                  | Plugin consequence                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `X-RateLimit-*` / `Retry-After` headers | Nothing. Zero occurrences across the full spec.                                            | A2 rate-limit guard is purely client-side (token bucket); A3 retry uses internal backoff, no server-provided delay. |
| 429 Too Many Requests                   | Not documented on any endpoint.                                                            | Treat as retryable if observed, but do not rely on its semantics.                                                   |
| `Idempotency-Key` header                | No request-level idempotency.                                                              | Dedup is client-side via `external_reference` pre-check (feature C1 + D2).                                          |
| `use_2026_api_changes`                  | Defaults to `true` globally.                                                               | Plugin targets the new behavior. No version-toggle option surfaced.                                                 |
| Webhook coverage                        | Only three events exist (`customer_invoice.created`, `quote.created`, `dms_file.created`). | No need for inbound webhook support in v1; we only push data.                                                       |

## Refresh protocol

When Pennylane updates the spec in a way that affects one of these ADRs:

1. `curl -sS https://pennylane.readme.io/openapi/accounting.json > /tmp/pennylane-spec.json`
2. `jq` the relevant `specJsonPath` out of each fixture you suspect.
3. Diff the output against the committed fixture.
4. If there's drift:
   - Update the fixture, bump `$meta.snapshotDate`.
   - Update the affected code (enum, filter syntax, endpoint payloads, etc.).
   - Run `make test` — the drift-guard tests (`vat-rate.unit.spec.ts` today; more to come) should turn green again.
   - Update this ADR with the new decision + a short paragraph noting what changed.
5. Commit the whole bundle with a message that cites the upstream change.

Never edit a fixture to silence a failing test without re-verifying the upstream. That defeats the guard.
