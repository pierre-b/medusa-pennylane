# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Features A4 + A5 (bundled) — Pennylane spec verification and verified VAT enum.** Mechanically verified the upstream OpenAPI spec for every endpoint this plugin uses. Committed 10 minimal excerpts (`src/modules/pennylane/client/__fixtures__/openapi-*.json`) plus a source-of-truth VAT enum fixture. New [`docs/spec-verification.md`](docs/spec-verification.md) ADR captures six decisions: VAT enum (A4), customers filter syntax, credit-note flow, cursor pagination, `transaction_reference` placement, and reservation of the PSP mapper-registry roadmap slot (P1 + P2). Drift-guard test in `vat-rate.unit.spec.ts` compares `PENNYLANE_VAT_RATES` against the fixture in both directions.
- **Feature A1 — `PennylaneClient` HTTP client.** Fetch-based transport for every future Pennylane call. Bearer-auth header, JSON serialization, `AbortController` timeouts (default 10s, per-call override), typed error mapping into six `MedusaError` subclasses (`PennylaneAuthError`, `PennylaneForbiddenError`, `PennylaneNotFoundError`, `PennylaneValidationError`, `PennylaneServerError`, `PennylaneNetworkError`), structured logging with `requestId` correlation, and token redaction via ES private fields. Exposed on `PennylaneModuleService` via `getClient()` and `healthCheck()` (wraps `GET /me`). Plugin options `apiToken` (required), `baseUrl`, `requestTimeoutMs`. 42 unit tests. See [`docs/http-client.md`](docs/http-client.md).

### Changed

- **`PENNYLANE_VAT_RATES` replaces the placeholder enum.** The 5.5% reduced French rate is `FR_55`, not `FR_055` (the latter would have been rejected by Pennylane). Ships 20 French codes + 8 special statuses. Non-French country codes remain available as plain strings for consumers that need them. Downstream features (D1/D2) now build invoice lines against this verified enum.

### Added (foundation, pre-A1)

- Project scaffold: Medusa v2 plugin layout, TypeScript config, peer dependencies pinned to Medusa 2.13.6.
- TDD infrastructure: Jest with `@swc/jest`, unit + integration-modules + integration-http test types.
- Lint + format: ESLint flat config, Prettier, typescript-eslint rules matching the chocolaterie reference project.
- Makefile as single CLI entry point (`make help` to list).
- Empty `pennylane` module skeleton: `InvoiceSync` and `CustomerSync` data models, `MedusaService` wrapper, `index.ts` module export.
- First Red-Green unit test: VAT rate enum placeholder, wired through `make test-unit`.
- HTTP + modules integration test harness (`make test-http`, `make test-integration`) configured with `--passWithNoTests` until the first in-host test lands via Yalc-wired fixtures.
- Apache-2.0 license + NOTICE.
- Public-repo boilerplate: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CONTRIBUTING.md` (issues-only policy — no external PRs accepted), GitHub issue templates, PR template (maintainer use), Dependabot config.
- CI workflow (lint, typecheck, tests, build) and release workflow (tag-triggered npm publish with OIDC provenance).
- `CLAUDE.md` documenting TDD discipline, primary-sources rule, five-pass code review, public-repo hygiene.
- `docs/README.md` feature index (empty, populated as features ship).

### Notes

- Pennylane spec discrepancies documented at foundation time were all resolved in feature A4 (see the Added section above). Kept here as a historical note: the foundation shipped with a placeholder enum and open questions about VAT codes, customers filter syntax, credit notes, and pagination.
- `medusaIntegrationTestRunner({ inApp: true })` requires a host `medusa-config.ts`, which a plugin package does not have. The first integration smoke test will be written against a minimal host fixture as part of the first feature PR rather than in the foundation.
