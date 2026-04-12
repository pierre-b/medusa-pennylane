# Feature Documentation

This directory contains one Markdown file per shipped feature. The index below is the source of truth — when a feature is added or renamed, update this file in the same PR.

## Features

<!-- Populated as features ship. Grouped to match the roadmap in the top-level README. -->

### A. HTTP client & primitives

- [A1 — HTTP client (`PennylaneClient`)](http-client.md) — fetch-based transport with Bearer auth, typed errors, AbortController timeouts, structured logging with token redaction, and a `healthCheck()` hitting `GET /me`.
- [A4 + A5 — Pennylane spec verification + VAT enum](spec-verification.md) — mechanically verified ADRs and committed OpenAPI fixtures covering the endpoints this plugin uses. Corrects `FR_055` → `FR_55`, decides customers filter syntax, credit-note flow, cursor pagination, `transaction_reference` placement, and reserves the PSP mapper-registry roadmap slot.

### P. PSP mappers

- [P1 + P2 — PSP mapper registry + Stripe mapper](psp-registry.md) — lazy registry that resolves `payment.provider_id` → `PspMapper` → Pennylane `transaction_reference`. Ships Stripe as the built-in catalogue entry (matches `pp_stripe_*`, extracts PaymentIntent id from `payment.data.id`). Plugin options: `onUnknownPsp`, `providerAliases`, `disableMappers`, `customMappers`.

### C. Customer sync

- [C1 + C2 — Customer upsert + billing address mapping](customer-upsert.md) — idempotent lookup-or-create of a Pennylane customer for a Medusa order, with the billing identity taken from `order.billing_address` (frozen at sale time per French invoicing law). Per-order customers for guest checkouts (SOTA 2026 pattern confirmed by Gemini). B2B/B2C heuristic from `billing_address.company`; SIREN + VAT from configurable `order.metadata` keys.

### D. Invoice sync

- [D1 — `buildInvoicePayload`](invoice-payload.md) — pure transform from Medusa `OrderDTO` + payment + PSP mapper → the JSON body Pennylane's `POST /customer_invoices` (Finalized branch) accepts. Robust HT extraction via `(item.total − item.tax_total)`, composes D5+D6 for line formatting + reconciliation, resolves `transaction_reference` through the caller's mapper with the `onUnknownPsp` policy applied on unresolved PSPs.
- [D5 + D6 — Invoice amount helpers](invoice-amount-helpers.md) — `centsToPennylaneDecimal` (cents → Pennylane decimal string with ISO 4217 currency decimals, fractional-cent precision for D6-adjusted lines) and `reconcileInvoiceLineTotals` (adjust the largest line by up to 1 cent so line totals match the order total). Pure helpers consumed by D1.

## Writing a feature doc

Every feature doc includes:

- **Purpose & motivation** — one paragraph. Why does this feature exist?
- **API** — endpoints added (method, path, request / response shapes).
- **Data models & fields** — what's persisted.
- **Workflows & steps** — names, inputs, outputs, compensation behavior.
- **Admin UI surfaces** — widget zones, UI routes, screenshots in `docs/assets/`.
- **Plugin options / env vars** — new configuration introduced by this feature.
- **Verification** — how to exercise the feature end-to-end locally.

Every feature doc ships in the same PR as the code it documents.
