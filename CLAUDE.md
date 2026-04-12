# medusa-plugin-pennylane — Agent Guide

## Overview

Public, open-source Medusa v2 plugin that syncs paid orders into Pennylane as customer invoices, with automatic Stripe reconciliation. Apache-2.0. Repo: https://github.com/pierre-b/medusa-pennylane. npm: `medusa-plugin-pennylane`.

Target host Medusa version: v2.13.6+. Node ≥20. Yarn 4 (corepack).

---

## Development Methodology: TDD

Red-Green-Refactor is **mandatory**. No exceptions.

1. **Red** — Write a failing test first. Run it. Confirm it fails for the right reason.
2. **Green** — Write the minimum implementation to make the test pass.
3. **Refactor** — Improve naming, structure, duplication — without changing behavior. Tests stay green.

Every one of these starts with a failing test:

- Public method on any module service
- Workflow step
- HTTP client method
- Subscriber (verify it triggers on the correct event)
- Admin API route (status codes, response shape, auth, validation errors)
- Payload builder / mapper / pure helper

If there is a branch, test both paths.

### Test taxonomy

| Location                               | Purpose                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/**/__tests__/**/*.unit.spec.ts`   | Pure unit tests, no Medusa container. HTTP client, VAT mapper, payload builders, pure helpers. |
| `src/modules/*/__tests__/**/*.spec.ts` | Module-level integration via `@medusajs/test-utils`.                                           |
| `integration-tests/http/*.spec.ts`     | Full plugin-inside-host HTTP tests via `medusaIntegrationTestRunner({ inApp: true })`.         |

Run via `make test-unit`, `make test-integration`, `make test-http`. CI runs all of them on every push to `main`.

---

## Primary-Sources Rule (non-negotiable)

Before writing any Pennylane API call: fetch `https://pennylane.readme.io/openapi/accounting.json`, grep for the endpoint in the downloaded file, and verify every field name, type, required flag, and enum value. Never rely on:

- web-search summaries
- agent-summarized docs
- secondary documentation (including `docs/` in this repo)
- ChatGPT / Claude recall

Every AI summarization layer loses precision. If the spec and a secondary source disagree, the spec wins — and update the secondary source.

For Medusa v2 patterns: query the MedusaDocs MCP tool (`mcp__plugin_medusa-dev__MedusaDocs__ask_medusa_question`) before inventing anything. When in doubt, read the actual Medusa source in `node_modules/@medusajs/*`.

---

## Five-Pass Code Review Protocol

Every piece of code MUST pass self-review before being committed to `main`.

### Pass 1 — Correctness

- Does it do what was asked? Re-read the original request.
- Edge cases: null, empty, duplicate, concurrent?
- Types strict? No `any`, no unsafe casts.
- All new code paths have tests?
- Queries efficient? Pennylane rate-limit respected?
- Medusa patterns followed? (MedusaDocs MCP if unsure)

### Pass 2 — Security

- No hardcoded secrets. API token via plugin options or env var only.
- Auth middleware on admin API routes.
- Input validation on every request body.
- No injection vectors.
- Error responses don't leak token, stack traces, or internal ids.

### Pass 3 — Quality

- Readable without comments (rename > comment).
- No dead code, no commented-out code, no stale TODOs.
- Single responsibility per function / file.
- No premature abstractions.
- Naming consistent with existing code.

### Pass 4 — Medusa/Plugin-Specific

- Data models use `model.define()`.
- Business logic in workflows, not routes or services.
- Module services extend `MedusaService`.
- Cross-module relations via `defineLink`, not FKs.
- Admin customizations use correct injection zones.
- Migrations generated after data model changes (`make db-generate MOD=pennylane`).
- Plugin options consumed via the module constructor's second argument.
- No hardcoded host-app assumptions (this plugin runs in any Medusa project).

### Pass 5 — Documentation

- Feature doc in `docs/` created or updated.
- `docs/README.md` index updated.
- `CHANGELOG.md` entry added under `[Unreleased]`.
- Makefile target added if a new command was introduced.

If any check fails → fix before presenting. No "known issues" left behind.

---

## Makefile = Single CLI Entry Point

Every script or CLI operation goes through a Makefile target. When you add a new script, add a target. When in doubt: `make help`.

Never leave a command undocumented. If a contributor must type a raw `yarn ...` or `npx ...` command, that's a bug.

---

## Documentation Discipline

Every feature ships a corresponding `docs/<feature>.md` in the same changeset as the code. `docs/README.md` is the index and must be kept current.

A feature doc includes:

- Purpose and motivation
- API endpoints (method, path, request/response)
- Data models and fields
- Workflows and steps
- Admin UI surfaces
- Plugin options / env vars
- Screenshots (if UI) in `docs/assets/`

Never ship code without docs. Never ship docs without code.

---

## Commit & Release Discipline

- Imperative mood. Present tense. Explain "why".
- Conventional Commits prefix: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`. Helps readability and manual `CHANGELOG.md` authoring.
- `make check && make test` before every commit. CI gate is not optional.
- One logical change per commit.
- Never commit `.env`, secrets, or generated files.
- Release flow is **manual**: edit `CHANGELOG.md` (Keep-a-Changelog format), `git tag vX.Y.Z`, push tag. `.github/workflows/release.yml` publishes to npm with OIDC provenance.

No AI-signature in commits (no `Co-Authored-By: Claude ...`).

---

## Public-Repo Hygiene

This repo is public. Apache-2.0 licensed.

- No hardcoded chocolaterie assumptions anywhere.
- No customer PII in tests, fixtures, screenshots, or commits.
- No private URLs, internal ticket references, or coworker names in commits or code.
- Fixtures should use obviously-fake data (`pi_3Test...`, `jean@example.test`, SIREN `123456789`).
- Maintainer commits directly to `main`; no pull-request workflow. The five-pass review runs before each commit — no human second opinion is available, so the discipline is on every commit author. Dependabot PRs are the only exception and exist only for dependency bumps.

---

## External API Verification (Pennylane-specific)

Hard rule for every Pennylane integration touch:

1. Fetch the raw OpenAPI spec: `curl https://pennylane.readme.io/openapi/accounting.json > /tmp/pennylane.json`
2. Grep for the endpoint / field name in the downloaded file.
3. Confirm: field name, type, required/optional, enum values, response schema.
4. Only then: write code or tests.

If the spec says something different from what the user's request implies, flag it. The spec wins.

For spec decisions already made, see [`docs/spec-verification.md`](docs/spec-verification.md) — ADRs for the VAT enum (`FR_55`, not `FR_055`), customers filter syntax, credit-note flow, cursor pagination, `transaction_reference` placement, and the PSP mapper registry. Committed fixtures under [`src/modules/pennylane/client/__fixtures__/`](src/modules/pennylane/client/__fixtures__/) are the in-repo source of truth.

---

## Directory Conventions

```
src/
  modules/pennylane/       # data models + service + HTTP client
  workflows/               # composed business logic
  subscribers/             # event handlers
  links/                   # cross-module relations
  admin/                   # widgets + UI routes (React)
  api/                     # admin + store HTTP routes (plugin-owned)
  jobs/                    # scheduled jobs
integration-tests/
  http/                    # full-stack tests via medusaIntegrationTestRunner
docs/                      # one markdown per feature + docs/README.md index
```

---

## When using Subagents and MCP Tools

- `mcp__plugin_medusa-dev__MedusaDocs__ask_medusa_question` — first stop for any Medusa v2 pattern question.
- For Pennylane questions: read the OpenAPI spec directly. Don't ask an agent — ask the JSON.
- Explore agents are great for codebase-wide patterns; don't waste them on questions a single grep answers.

---

## Inherited Preferences

- Makefile is the single CLI entry point (add a target for every command).
- `make check` gate before every commit/push.
- OpenAPI specs / official docs before any third-party API code.
- No AI signatures in git commits.
- Feature inventories are roadmaps, not execution batches — one feature per plan.
