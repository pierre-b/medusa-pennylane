# Roadmap

The comprehensive feature inventory for `medusa-plugin-pennylane`. Each row is a discrete feature implemented in its own planning session following strict Red-Green-Refactor and the five-pass review in [`CLAUDE.md`](CLAUDE.md). Features are committed directly to `main`; shipped ones cross over into [`docs/README.md`](docs/README.md).

## Legend

- ✅ shipped (see `docs/` + `CHANGELOG.md`)
- 🔄 in progress
- ⏳ planned

## A. HTTP client & primitives

| #   | Feature                                                                                                                                        | Status | Notes                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| A1  | `PennylaneClient` — fetch-based, Bearer auth, typed errors, AbortController timeout, structured logging, `healthCheck()`                       | ✅     | [doc](docs/http-client.md)                                                               |
| A2  | Rate-limit guard — in-memory token bucket respecting 25 req / 5s; pluggable backend later                                                      | ⏳     | No `X-RateLimit-*` headers on the Pennylane side — purely client-driven                  |
| A3  | Retry with exponential backoff — 5xx + network only, never on 4xx validation                                                                   | ⏳     | 429 isn't documented but treat as retryable if observed                                  |
| A4  | Spec verification tasks — capture fixtures for the exact VAT enum, `GET /customers` filter syntax, credit-note endpoint shape, pagination mode | ✅     | [doc](docs/spec-verification.md) — 10 fixtures under `__fixtures__/`, 6 ADRs             |
| A5  | VAT code enum — typed TS enum seeded from verified spec values                                                                                 | ✅     | Bundled into A4: `FR_55` not `FR_055`, 20 FR codes + 8 specials, drift-guard test active |

## P. PSP mappers (Payment Service Providers)

The plugin ships a registry of PSP mappers with lazy resolution on demand. Each mapper converts a Medusa `PaymentDTO` into the `transaction_reference` triplet that Pennylane uses to auto-reconcile an invoice against the right bank transaction. Adding new PSPs is a catalogue entry, not a fork. See [`docs/psp-registry.md`](docs/psp-registry.md) and [ADR-006](docs/spec-verification.md#adr-006--psp-mapper-registry-becomes-part-of-the-plugin-core).

| #   | Feature                                                                                                                                                                   | Status | Notes                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| P1  | `PspMapperRegistry` infrastructure — mapper interface, catalogue, options (`onUnknownPsp`, `providerAliases`, `disableMappers`, `customMappers`), boot-time validation    | ✅     | [doc](docs/psp-registry.md). Lazy resolution; auto-detection deferred to P3.                                     |
| P2  | `stripeMapper` catalogue entry — `^pp_stripe_` → `{banking_provider:"stripe", provider_field_name:"payment_id", provider_field_value:<payment.data.id>}` + refund variant | ✅     | Bundled into P1. Returns `null` when `payment.data.id` missing → treated as unknown-PSP.                         |
| P3  | Boot-time auto-detection via loader + workflow calling `paymentModuleService.listPaymentProviders()` + log recap                                                          | ⏳     | Requires a loader (Medusa module isolation blocks direct injection). Observability only — runtime already works. |

## B. Data model & persistence

| #   | Feature                                                                                                                   | Status          | Notes                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------- |
| B1  | `InvoiceSync` model — `medusa_order_id`, `pennylane_invoice_id`, `status`, `external_reference`, `last_error`, timestamps | ✅ (foundation) | Skeleton already in place; may extend during D3   |
| B2  | `CustomerSync` model — `medusa_customer_id`, `pennylane_customer_id`, `type`                                              | ✅ (foundation) | Skeleton already in place                         |
| B3  | Module links — `order ↔ invoice-sync`, `customer ↔ customer-sync`                                                         | ⏳              | Lets admin widgets query via Medusa's `Query` API |
| B4  | First real migration generated via `make db-generate MOD=pennylane`                                                       | ⏳              | Needed before B3 can run against a real DB        |

## C. Customer sync

| #   | Feature                                                                                                                                                  | Status | Notes                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| C1  | `upsertPennylaneCustomer` — idempotent lookup-or-create via `external_reference`, B2C/B2B via `billing_address.company`, SIREN/VAT from `order.metadata` | ✅     | [doc](docs/customer-upsert.md). Per-order customers for guests per Gemini's SOTA 2026 analysis. |
| C2  | `toPennylaneBillingAddress` — Medusa address → Pennylane `billing_address` pure mapper                                                                   | ✅     | Bundled into C1. Required-field throws + country uppercase.                                     |

## D. Invoice sync (core flow)

| #   | Feature                                                                                                            | Status | Notes                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `build-invoice-payload` step — pure function, Medusa order → Pennylane `POST /customer_invoices` body              | ✅     | [doc](docs/invoice-payload.md). HT extraction via `(total − tax_total)`; composes D5/D6/P1. 39 new tests.                                    |
| D2  | `create-pennylane-invoice` step — finalized (`draft: false`) with `transaction_reference` resolved from PSP mapper | ✅     | [doc](docs/invoice-create.md). Idempotent pre-check on `external_reference`; returns `{invoiceId, externalReference, action}`. 10 new tests. |
| D3  | `sync-order-to-pennylane` workflow — orchestrates C1 → D1 → D2 → persist to `InvoiceSync`                          | ⏳     | Compensation on failure; partial-state recovery                                                                                              |
| D4  | Subscriber on `order.payment_captured` — invokes D3                                                                | ⏳     | Idempotent: refuses to duplicate on replay                                                                                                   |
| D5  | Amount conversion helper — Medusa cents int → Pennylane decimal string                                             | ✅     | [doc](docs/invoice-amount-helpers.md). ISO 4217 table; 0/2/3-decimal currencies; 6 decimals for fractional input.                            |
| D6  | Totals reconciliation — sum of lines == order total; adjust largest line by ≤0.01 if drift                         | ✅     | Bundled with D5. Generic signature. Fractional-cent behavior with quantity > 1 flagged for D2 live smoke test.                               |

## E. Refunds → credit notes

| #   | Feature                                                                                    | Status | Notes                          |
| --- | ------------------------------------------------------------------------------------------ | ------ | ------------------------------ |
| E1  | Decide credit-note endpoint (body flag vs separate `link_credit_note`) against the spec    | ⏳     | Outcome of A4                  |
| E2  | `create-credit-note` step                                                                  | ⏳     |                                |
| E3  | `link-credit-note` step (`POST /customer_invoices/{original}/link_credit_note`)            | ⏳     | Only if E1 points that way     |
| E4  | Refund subscriber — Medusa event TBD (query MedusaDocs MCP); triggers credit-note workflow | ⏳     | Partial + full refund coverage |

## F. Product sync (one-way, Medusa → Pennylane)

| #   | Feature                                                                                 | Status | Notes                                        |
| --- | --------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| F1  | `upsert-pennylane-product` step — by `external_reference = medusa product id`           | ⏳     |                                              |
| F2  | Bulk sync script — `make sync-products` — paged over Medusa catalog with 200ms throttle | ⏳     | Runs inside host app, not in the plugin repo |
| F3  | Admin-triggered single product sync — admin API route called from the product widget    | ⏳     |                                              |
| F4  | Subscriber on `product.updated` — opt-in via `autoSyncProducts: true`                   | ⏳     | Off by default                               |

## G. Admin UI

| #   | Feature                                                                     | Status | Notes                                                                                    |
| --- | --------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| G1  | Order detail widget — injection zone `order.details.side.bottom`            | ⏳     | Shows invoice ID, status, PDF link, last error                                           |
| G2  | "Resync" button in widget — calls `POST /admin/pennylane/orders/:id/resync` | ⏳     | Optimistic UI, error handling                                                            |
| G3  | Product widget — injection zone `product.details.side.bottom`               | ⏳     | Shows Pennylane product id, VAT code, manual sync button                                 |
| G4  | Settings page — `src/admin/routes/settings/pennylane/page.tsx`              | ⏳     | Displays config, masked token preview, test-connection button powered by `healthCheck()` |
| G5  | Admin API routes backing all UI above — auth-protected                      | ⏳     | One route per widget action                                                              |

## H. Configuration & options surface

| #   | Feature                                                                                                                        | Status | Notes                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------- |
| H1  | Plugin options schema (zod) — `apiToken` (required), `baseUrl`, `defaultShippingVatRate`, `autoSyncProducts`, `vatMetadataKey` | ⏳     | Fail-fast on boot when invalid                      |
| H2  | Env-var fallbacks — any option accepts `process.env.PENNYLANE_*` alternative                                                   | ⏳     | Documented in README                                |
| H3  | VAT metadata key — configurable (default `pennylane_vat_rate`)                                                                 | ⏳     | Allows hosts to rename the per-product metadata key |

## I. Observability

| #   | Feature                                                                                                 | Status | Notes                          |
| --- | ------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| I1  | Structured logging — already implemented by A1                                                          | ✅     |                                |
| I2  | Error classification — transient vs permanent — drives retry decision                                   | ⏳     | Hooks into A3                  |
| I3  | Dead-letter persistence — failed syncs write `last_error` to `InvoiceSync`, surfaced in admin widget G1 | ⏳     | Ties admin UI to sync failures |

## J. Documentation

| #   | Feature                                                            | Status | Notes                |
| --- | ------------------------------------------------------------------ | ------ | -------------------- |
| J1  | `docs/README.md` index                                             | ✅     | Updated per feature  |
| J2  | One `docs/<feature>.md` per A–I row that ships                     | 🔄     | 1 of ~25 shipped     |
| J3  | Screenshots for admin widgets under `docs/assets/`                 | ⏳     | Added when G\* lands |
| J4  | Upgrade guide — document breaking options changes per version bump | ⏳     | First needed at 1.0  |

## K. Release engineering

| #   | Feature                                          | Status          | Notes                                |
| --- | ------------------------------------------------ | --------------- | ------------------------------------ |
| K1  | Manual `CHANGELOG.md` + `git tag vX.Y.Z` flow    | ✅ (foundation) |                                      |
| K2  | npm publish provenance wired in `release.yml`    | ✅ (foundation) | OIDC-signed                          |
| K3  | Dependabot config for npm + GitHub Actions bumps | ✅ (foundation) | Weekly                               |
| K4  | Issue templates — bug report, feature request    | ✅ (foundation) | PR template kept for Dependabot only |

## Cycle

1. Pick the next feature — usually the top unblocked row above
2. Write a dedicated plan file under `.claude/plans/pennylane-<feature-id>-<slug>.md`
3. Red-Green-Refactor each TDD cycle, commit per logical cycle, never skip the failing test
4. Run the five-pass review before each commit
5. Run `make check && make test && make build` — all must be green
6. Push directly to `main`
7. Update this `ROADMAP.md` (mark feature as shipped, add status notes for any new discoveries)
8. Back to step 1

See [`CLAUDE.md`](CLAUDE.md) for TDD discipline, the primary-sources rule, and the five-pass review protocol.
