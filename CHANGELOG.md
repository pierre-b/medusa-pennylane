# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: Medusa v2 plugin layout, TypeScript config, peer dependencies pinned to Medusa 2.13.6.
- TDD infrastructure: Jest with `@swc/jest`, unit + integration-modules + integration-http test types.
- Lint + format: ESLint flat config, Prettier, typescript-eslint rules matching the chocolaterie reference project.
- Makefile as single CLI entry point (`make help` to list).
- Empty `pennylane` module skeleton: `InvoiceSync` and `CustomerSync` data models, `MedusaService` wrapper, `index.ts` module export.
- First Red-Green unit test: VAT rate enum placeholder, wired through `make test-unit`.
- HTTP + modules integration test harness (`make test-http`, `make test-integration`) configured with `--passWithNoTests` until the first in-host test lands via Yalc-wired fixtures.
- Apache-2.0 license + NOTICE.
- Public-repo boilerplate: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CONTRIBUTING.md`, GitHub issue templates, PR template, Dependabot config.
- CI workflow (lint, typecheck, tests, build) and release workflow (tag-triggered npm publish with OIDC provenance).
- `CLAUDE.md` documenting TDD discipline, primary-sources rule, five-pass code review, public-repo hygiene.
- `docs/README.md` feature index (empty, populated as features ship).

### Notes

- Known Pennylane spec discrepancies to resolve during feature A4 before any Pennylane HTTP call is committed: exact VAT enum codes (`FR_055` vs `FR_55`), credit-note endpoint shape, `GET /customers` filter syntax, pagination mode.
- `medusaIntegrationTestRunner({ inApp: true })` requires a host `medusa-config.ts`, which a plugin package does not have. The first integration smoke test will be written against a minimal host fixture as part of the first feature PR rather than in the foundation.
