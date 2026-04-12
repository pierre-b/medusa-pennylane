# Contributing

Thanks for your interest in improving `medusa-plugin-pennylane`. This document explains how to develop and submit changes.

## Ground rules

1. **TDD is mandatory.** Every change — feature, bug fix, refactor — starts with a failing test. See the Red-Green-Refactor section below.
2. **Primary sources only.** When touching Pennylane API calls, verify against the OpenAPI spec (`https://pennylane.readme.io/openapi/accounting.json`). When touching Medusa patterns, verify against official Medusa docs or source. Never trust summaries.
3. **One feature per PR.** Don't bundle unrelated changes. Features from the roadmap are picked up in their own planning session and merged independently.
4. **Docs ship with code.** Every feature adds or updates a file under `docs/` and the `docs/README.md` index. Every PR adds an entry under `[Unreleased]` in `CHANGELOG.md`.

## Prerequisites

- Node.js ≥ 20 (use `.nvmrc`)
- Yarn 4 via Corepack (`corepack enable`)
- Docker (for PostgreSQL + Redis in integration tests) or a local PostgreSQL 16 + Redis 7

## Setup

```bash
git clone https://github.com/pierre-b/medusa-pennylane.git
cd medusa-pennylane
make install
make check      # verify the tree is green before you touch anything
make test-unit  # verify the baseline test passes
```

## Development loop

```bash
make dev        # Yalc watch mode — publishes to the local Yalc store on every change
```

Wire the plugin into a Medusa host app for end-to-end testing:

```bash
# In a Medusa host project:
yarn add --dev yalc
yarn medusa plugin:add medusa-plugin-pennylane
```

Register in the host's `medusa-config.ts` and start its dev server.

## Red-Green-Refactor

1. **Red.** Add a failing test. Run `make test-unit` (or `make test-http` for integration) and confirm it fails with the expected error.
2. **Green.** Write the minimum production code to turn it green. Resist adding extras.
3. **Refactor.** Improve names, structure, duplication — tests stay green the whole time.

### Test taxonomy

| Path                                   | Command                 | When to use                                                     |
| -------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| `src/**/__tests__/**/*.unit.spec.ts`   | `make test-unit`        | Pure functions, mappers, HTTP client, VAT logic.                |
| `src/modules/*/__tests__/**/*.spec.ts` | `make test-integration` | Module-level tests that need a service container.               |
| `integration-tests/http/*.spec.ts`     | `make test-http`        | Full plugin-in-host HTTP tests (`medusaIntegrationTestRunner`). |

## Five-pass code review

Before opening a PR, walk through each pass. The PR template forces this — do it honestly.

1. **Correctness** — Does it do what was asked? Edge cases tested? Types strict?
2. **Security** — No hardcoded tokens. Auth on admin routes. Input validation. No leaked internals.
3. **Quality** — Readable. No dead code. Single responsibility. No premature abstraction.
4. **Medusa-specific** — `model.define`, workflows for business logic, module links, correct admin zones, migrations generated.
5. **Documentation** — Feature doc added/updated, `docs/README.md` updated, `CHANGELOG.md` `[Unreleased]` entry, new Makefile target if a new command was introduced.

## Commit style

- Imperative mood, present tense. Example: `feat: add Pennylane rate-limit guard`.
- Conventional Commits prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`, `build:`.
- One logical change per commit.
- Never include AI co-author trailers (no `Co-Authored-By: Claude ...`).
- Never skip hooks (`--no-verify`) unless explicitly requested by a maintainer.

## Submitting a PR

1. Run the full gate locally: `make check && make test`.
2. Open a PR against `main`. Fill in the PR template completely.
3. Ensure CI is green before requesting review.
4. Keep the PR focused — one feature, one fix, one docs update.

## Releases

Maintainer-only. Manual flow:

1. Edit `CHANGELOG.md`: move entries from `[Unreleased]` under a new `## [X.Y.Z] - YYYY-MM-DD` heading.
2. Commit: `git commit -m "chore(release): vX.Y.Z"`.
3. Tag: `git tag vX.Y.Z`.
4. Push: `git push --follow-tags`.

The `release.yml` workflow runs on tag push and publishes to npm with OIDC provenance.

## Reporting bugs / asking for features

Use GitHub Issues with the appropriate template. Include:

- Medusa version, Node version, plugin version
- Minimal reproduction (config snippet + steps)
- Expected vs actual behavior
- Relevant logs (redact tokens)

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.
