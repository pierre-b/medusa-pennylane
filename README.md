# medusa-plugin-pennylane

[![CI](https://github.com/pierre-b/medusa-pennylane/actions/workflows/ci.yml/badge.svg)](https://github.com/pierre-b/medusa-pennylane/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/medusa-plugin-pennylane.svg)](https://www.npmjs.com/package/medusa-plugin-pennylane)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Sync paid [Medusa v2](https://medusajs.com/) orders into [Pennylane](https://www.pennylane.com/) as customer invoices, with automatic Stripe reconciliation. Built for French e-commerce stores that need compliant invoicing without manual bookkeeping.

> **Status:** foundation only. Feature work (A1 onwards) tracked in [GitHub Issues](https://github.com/pierre-b/medusa-pennylane/issues).

## What it does

```
Medusa order paid (Stripe)
       │
       ▼
order.payment_captured  ──►  Pennylane individual/company customer (upsert)
                             Pennylane customer invoice (finalized)
                             transaction_reference → Stripe payment_id
                             invoice ID stored on the Medusa order
```

Refunds produce credit notes. Products can be one-way synced so invoice lines reference Pennylane `product_id` for consistent ledger mapping.

## Requirements

- Medusa v2.13.6 or later
- Node.js ≥ 20
- A Pennylane subscription with API access and the scopes:
  - `customer_invoices:all`
  - `customers:all`
  - `products:all`
  - `file_attachments:all`
- Stripe connected inside Pennylane (Settings → Connectivité → Intégrations) for automatic reconciliation

## Install

```bash
yarn add medusa-plugin-pennylane
```

## Configure

`medusa-config.ts`:

```ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "medusa-plugin-pennylane",
      options: {
        apiToken: process.env.PENNYLANE_API_TOKEN,
      },
    },
  ],
});
```

All options (full documentation ships with feature H1):

| Option                   | Default                                     | Description                                                                                                    |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apiToken`               | — (required)                                | Pennylane company API token or OAuth bearer token                                                              |
| `baseUrl`                | `https://app.pennylane.com/api/external/v2` | Override for staging environments                                                                              |
| `requestTimeoutMs`       | `10000`                                     | Per-request abort timeout                                                                                      |
| `onUnknownPsp`           | `"warn"`                                    | Policy when no PSP mapper resolves: `"warn"` \| `"accept"` \| `"error"`. See [PSP docs](docs/psp-registry.md). |
| `providerAliases`        | `{}`                                        | Map a Medusa `provider_id` to a known mapper `id`, e.g. `{"pp_my_fork": "stripe"}`                             |
| `disableMappers`         | `[]`                                        | Disable built-in mappers by id, e.g. `["stripe"]`                                                              |
| `customMappers`          | `[]`                                        | User-supplied `PspMapper[]` (last-resort catalogue entries)                                                    |
| `defaultShippingVatRate` | `FR_200`                                    | VAT code applied to shipping lines (feature H-series)                                                          |
| `autoSyncProducts`       | `false`                                     | Subscribes to `product.updated` and pushes changes to Pennylane (feature F4)                                   |
| `vatMetadataKey`         | `pennylane_vat_rate`                        | Product metadata key used to look up the VAT code per item (feature H3)                                        |

## VAT mapping convention

Each Medusa product carries its Pennylane VAT code under `metadata.pennylane_vat_rate`. The plugin reads this when building invoice lines — there is no resolver function and no plugin-level mapping table.

Example (Medusa admin → Product → Metadata):

```json
{
  "pennylane_vat_rate": "FR_55"
}
```

French chocolaterie reference (confirm with your expert-comptable):

| Product type                                  | Code     | Rate               |
| --------------------------------------------- | -------- | ------------------ |
| Basic chocolate (tablets, spread, powder)     | `FR_55`  | 5.5%               |
| Confectionery (bonbons, truffles, gift boxes) | `FR_200` | 20%                |
| Shipping                                      | `FR_200` | 20% (or pro-rated) |

The full list of accepted codes is in [`docs/spec-verification.md`](docs/spec-verification.md#adr-001--vat-enum-fr_55-not-fr_055). Verified directly against the Pennylane OpenAPI spec — the `FR_55` (no leading zero) form is authoritative.

## Admin UI

Once feature G lands:

- Order detail widget: invoice ID, sync status, Pennylane PDF link, manual resync button
- Product detail widget: VAT code, Pennylane product id, manual product sync
- Settings page (`Settings → Pennylane`): masked token, base URL, test-connection button, VAT legend

## Development

```bash
make install        # yarn install
make dev            # yarn medusa plugin:develop (Yalc watch mode)
make check          # lint + format check + type check (CI gate)
make test           # unit + HTTP integration tests
make publish-local  # publish to local Yalc store for host-app testing
```

See the full target list: `make help`.

## Roadmap

All planned features are tracked in GitHub Issues under the `roadmap` label, grouped as:

- **A.** HTTP client & primitives (client, rate-limiter, retry, VAT enum, spec verification)
- **B.** Data models & links (InvoiceSync, CustomerSync, module links)
- **C.** Customer sync
- **D.** Invoice sync (core flow)
- **E.** Refunds → credit notes
- **F.** Product sync (one-way)
- **G.** Admin UI
- **H.** Configuration & options
- **I.** Observability
- **J.** Documentation
- **K.** Release engineering

Each feature is implemented in its own planning session following strict Red-Green-Refactor with the five-pass review protocol. See [`CLAUDE.md`](CLAUDE.md).

## Contributing

This project **does not accept pull requests**. Contributions are welcome through GitHub Issues:

- [Report a bug](https://github.com/pierre-b/medusa-pennylane/issues/new?template=bug_report.md)
- [Request a feature](https://github.com/pierre-b/medusa-pennylane/issues/new?template=feature_request.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) for details and [SECURITY.md](SECURITY.md) for private security reports.

## License

Apache-2.0 © Pierre Bertet. See [LICENSE](LICENSE).
