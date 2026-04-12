<!--
  ⚠️ External pull requests are not accepted and will be closed.

  If you're not a maintainer: please open an issue instead.
    • Bug:     https://github.com/pierre-b/medusa-pennylane/issues/new?template=bug_report.md
    • Feature: https://github.com/pierre-b/medusa-pennylane/issues/new?template=feature_request.md

  Maintainers: use the checklist below.
-->

## Summary

<!-- What does this PR do? One or two sentences. Link the related issue / roadmap item. -->

Closes #

## Changes

-

## TDD evidence

- [ ] A failing test was added first (Red)
- [ ] Minimal implementation turned it green (Green)
- [ ] Any cleanup kept tests green (Refactor)

## Five-pass review

- [ ] **Correctness** — does what was asked, edge cases covered, no unsafe casts, tests for all new paths
- [ ] **Security** — no hardcoded secrets, auth on admin routes, input validation, no leaked internals
- [ ] **Quality** — readable, no dead code, single responsibility, no premature abstractions
- [ ] **Medusa-specific** — `model.define`, workflows for business logic, module links, correct admin zones, migrations generated
- [ ] **Documentation** — feature doc in `docs/`, `docs/README.md` index updated, `CHANGELOG.md` `[Unreleased]` entry added, new Makefile target if applicable

## Pennylane spec verification (if this PR touches Pennylane API calls)

- [ ] Fetched the OpenAPI spec at `https://pennylane.readme.io/openapi/accounting.json`
- [ ] Verified every field name, type, required flag, and enum value used in this PR
- [ ] Updated any secondary docs that disagreed with the spec

## Local verification

- [ ] `make check` passes
- [ ] `make test` passes
