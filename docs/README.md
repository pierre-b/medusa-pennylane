# Feature Documentation

This directory contains one Markdown file per shipped feature. The index below is the source of truth — when a feature is added or renamed, update this file in the same PR.

## Features

<!-- Populated as features ship. Grouped to match the roadmap in the top-level README. -->

### A. HTTP client & primitives

- [A1 — HTTP client (`PennylaneClient`)](http-client.md) — fetch-based transport with Bearer auth, typed errors, AbortController timeouts, structured logging with token redaction, and a `healthCheck()` hitting `GET /me`.
- [A4 + A5 — Pennylane spec verification + VAT enum](spec-verification.md) — mechanically verified ADRs and committed OpenAPI fixtures covering the endpoints this plugin uses. Corrects `FR_055` → `FR_55`, decides customers filter syntax, credit-note flow, cursor pagination, `transaction_reference` placement, and reserves the PSP mapper-registry roadmap slot.

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
