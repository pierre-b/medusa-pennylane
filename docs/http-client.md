# HTTP client (`PennylaneClient`)

> Feature A1 — ships the low-level HTTP client that every later Pennylane call is built on. No endpoint-specific logic yet; this doc covers the transport layer only.

## Purpose

`PennylaneClient` is a thin, typed, test-driven wrapper around Node 20's native `fetch` + `AbortController`. It handles:

- Bearer authentication
- JSON request serialization and response parsing
- Pennylane error-body decoding into typed `MedusaError` subclasses
- Per-request timeouts via `AbortController`
- Structured logging with correlation IDs and token redaction

Explicitly **not** in scope: rate limiting (see A2), retries / backoff (A3), pagination, endpoint-specific payload shaping.

## Plugin options

The client is instantiated by `PennylaneModuleService` from plugin options declared in the host app's `medusa-config.ts`:

| Option             | Type     | Default                                     | Required |
| ------------------ | -------- | ------------------------------------------- | -------- |
| `apiToken`         | `string` | —                                           | yes      |
| `baseUrl`          | `string` | `https://app.pennylane.com/api/external/v2` | no       |
| `requestTimeoutMs` | `number` | `10000`                                     | no       |

Example:

```ts
// medusa-config.ts
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

A missing or non-string `apiToken` throws `medusa-plugin-pennylane: required option 'apiToken' is missing.` at boot — the module refuses to register.

## Public surface

```ts
import { PennylaneClient } from "medusa-plugin-pennylane/modules/pennylane/client/pennylane-client";

const client = new PennylaneClient({ apiToken: "..." });

client.get<T>(path, { query?, timeoutMs? });
client.post<T>(path, { query?, body?, timeoutMs? });
client.put<T>(path, { query?, body?, timeoutMs? });
client.delete<T>(path, { query?, timeoutMs? });
client.healthCheck(); // → MeResponse (from GET /me)
```

Paths are relative to `baseUrl`. The client tolerates extra slashes on either side: `baseUrl: "…/v2/"` + `path: "/customer_invoices"` → `…/v2/customer_invoices`.

`query` values are serialized with `URLSearchParams`. `undefined` values are dropped; arrays are expanded to repeated keys (`{ids: [1,2]}` → `?ids=1&ids=2`). Booleans and numbers stringify naturally.

`body` is JSON-stringified. `Content-Type: application/json` is set only when a body is present.

In a Medusa workflow, get the client via the service:

```ts
const pennylane = container.resolve("pennylane");
const me = await pennylane.getClient().healthCheck();
```

`pennylane.healthCheck()` is available as a shortcut.

## Error hierarchy

All errors extend `MedusaError`, so Medusa's HTTP middleware automatically renders the right status when they bubble out of a route or workflow. Every error carries `.status`, `.pennylaneBody`, and sometimes `.code` / `.field` / `.cause`.

| Error class                | HTTP      | `MedusaError.Types` | When                                                                                                        |
| -------------------------- | --------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PennylaneAuthError`       | 401       | `UNAUTHORIZED`      | Invalid or expired token                                                                                    |
| `PennylaneForbiddenError`  | 403       | `NOT_ALLOWED`       | Scope missing on the token                                                                                  |
| `PennylaneNotFoundError`   | 404       | `NOT_FOUND`         | Resource doesn't exist                                                                                      |
| `PennylaneValidationError` | 400 / 422 | `INVALID_DATA`      | Malformed request, business-rule violation. Sets `.code` and `.field` when Pennylane returns them           |
| `PennylaneServerError`     | 5xx       | `UNEXPECTED_STATE`  | Pennylane outage / gateway failure                                                                          |
| `PennylaneNetworkError`    | `null`    | `UNEXPECTED_STATE`  | `fetch()` threw (DNS, TCP reset, TLS failure) or abort timed out. `.cause` preserves the original throwable |

Pennylane's 400 responses come in three shapes (all handled): `{error, status}`, `{message, code}`, `{message, code, field}`. The primary human-readable message prefers `body.error`, then `body.message`, then falls back to `Pennylane request failed with status <n>`.

A non-JSON error body (HTML error page, truncated response) is tolerated: `.pennylaneBody` is set to `null`, the error class is still picked by HTTP status.

## Timeouts

Default per-request timeout: 10 seconds. Override globally via `requestTimeoutMs` in plugin options, or per-call via `opts.timeoutMs`.

Abort is implemented with a stock `AbortController`; the timer is cleared in a `finally` block so no handles leak on either success or failure.

Abort detection recognizes `name === "AbortError"`, `code === "ABORT_ERR"`, and the legacy numeric `code === 20` — the native DOMException thrown by Node's undici fetch.

## Logging

If a `logger` is passed in plugin options (or injected via the Medusa DI container when used through `PennylaneModuleService`), every request emits exactly one log line:

| Outcome           | Level   | Context fields                                                         |
| ----------------- | ------- | ---------------------------------------------------------------------- |
| 2xx               | `info`  | `method, path, status, durationMs, requestId`                          |
| 4xx               | `warn`  | ` + errorMessage`                                                      |
| 5xx               | `error` | ` + errorMessage`                                                      |
| Network / timeout | `error` | `method, path, status: "network", durationMs, requestId, errorMessage` |

`requestId` is a `crypto.randomUUID()` generated at request start — use it to grep across Medusa logs for the full lifecycle of a single Pennylane call.

What is **never** logged: the `Authorization` header, the `apiToken`, any query-string values, or the request body. The token is stored in a JavaScript private class field (`#apiToken`) so `JSON.stringify(client)` cannot leak it via enumeration.

The service adapts Medusa's narrow `Logger` (message + `Error`) to the client's (message + context record) by JSON-embedding the context in the message string. Result in Medusa logs:

```
info pennylane request {"method":"GET","path":"/me","status":200,"durationMs":42,"requestId":"6f8c…"}
```

## Verification

End-to-end smoke (requires a valid Pennylane company API token):

```ts
// inside a Medusa custom script or admin route
const pennylane = container.resolve("pennylane");
const me = await pennylane.healthCheck();
console.log(me.company.name, me.scopes);
```

Expect a populated `user`, `company`, and non-empty `scopes` array. A missing or revoked token raises `PennylaneAuthError`.

## Not included here (tracked roadmap)

- A2 — rate-limit guard (25 req / 5s token bucket)
- A3 — exponential-backoff retry on 5xx (never on 4xx)
- A4 — OpenAPI spec verification (exact VAT enum, customers filter syntax, credit-note endpoint shape, pagination mode)
- G4 — admin "Test connection" button using `healthCheck()`
- H1 — zod schema for plugin options
- H2 — environment-variable fallbacks for every option
