# Pennylane OpenAPI fixtures

Minimal excerpts of the Pennylane OpenAPI spec that the plugin depends on. Every file captures a specific endpoint's request / response schema or an enum source-of-truth (e.g., `openapi-vat-rates.json`).

## Provenance

- **Upstream:** https://pennylane.readme.io/openapi/accounting.json (OpenAPI 3.0.1)
- **Snapshot date:** set per file in `$meta.snapshotDate`
- **Spec JSON path:** `$meta.specJsonPath` — a human-readable pointer into the spec
- **jq query:** `$meta.jqQuery` — a valid jq expression that extracts the fixtured slice; copy-paste-runnable for re-verification

Each file contains a `$meta` block up-front so future sessions can locate and re-verify every claim against the upstream spec.

## Why committed

- **Drift detection.** Tests like `vat-rate.unit.spec.ts` load a fixture and assert the runtime code still matches the spec snapshot. Upstream changes break CI until we refresh both.
- **Offline documentation.** Feature plans can cite a committed fixture instead of a remote URL that might disappear.
- **Audit trail.** Every fixture change is a git commit; `git log src/modules/pennylane/client/__fixtures__/` shows when spec assumptions were last validated.

## Refresh protocol

When a fixture's spec JSON path changes upstream:

1. Re-fetch the full spec: `curl -sS https://pennylane.readme.io/openapi/accounting.json > /tmp/pennylane-spec.json`
2. Re-extract the excerpt by copy-pasting the fixture's `$meta.jqQuery` into `jq`: e.g., `jq "$(jq -r '."$meta".jqQuery' src/modules/pennylane/client/__fixtures__/openapi-vat-rates.json)" /tmp/pennylane-spec.json`
3. Update the fixture file; bump `$meta.snapshotDate`
4. Update any code that disagreed
5. Run `make test` — drift-guard tests should turn green
6. Commit with a message that cites the upstream change you observed

Never edit a fixture to make a test pass without re-verifying the upstream. That defeats the whole point.

## Non-runtime files

Fixtures live under `src/` purely for Jest auto-discovery and IDE-friendliness. They are **not** compiled into the distributed plugin (the `medusa plugin:build` script ignores `__fixtures__/` folders).
