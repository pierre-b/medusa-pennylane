import { randomUUID } from "node:crypto";

import {
  PennylaneAuthError,
  PennylaneForbiddenError,
  PennylaneNetworkError,
  PennylaneNotFoundError,
  PennylaneServerError,
  PennylaneValidationError,
  type PennylaneErrorContext,
} from "./errors";

export interface PennylaneClientParams {
  apiToken: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
  logger?: PennylaneLogger;
}

export interface PennylaneLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export type QueryValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
}

export interface MeResponse {
  user: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    locale: string;
  };
  company: {
    id: number;
    name: string;
    reg_no: string;
  };
  scopes: string[];
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

const DEFAULT_BASE_URL = "https://app.pennylane.com/api/external/v2";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class PennylaneClient {
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  readonly #apiToken: string;
  readonly #logger: PennylaneLogger | undefined;

  constructor(params: PennylaneClientParams) {
    if (!params?.apiToken || typeof params.apiToken !== "string") {
      throw new Error(
        "PennylaneClient: `apiToken` is required (received none)."
      );
    }
    this.#apiToken = params.apiToken;
    this.baseUrl = (params.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.requestTimeoutMs =
      params.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#logger = params.logger;
  }

  get<T>(path: string, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("GET", path, opts);
  }

  post<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, opts);
  }

  put<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>("PUT", path, opts);
  }

  delete<T>(path: string, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  healthCheck(): Promise<MeResponse> {
    return this.get<MeResponse>("/me");
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const timeoutMs = opts.timeoutMs ?? this.requestTimeoutMs;
    const requestId = randomUUID();
    const startMs = Date.now();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiToken}`,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    init.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const wrapped = wrapNetworkError(err, timeoutMs);
      this.#log("error", {
        method,
        path,
        status: "network",
        durationMs: Date.now() - startMs,
        requestId,
        errorMessage: wrapped.message,
      });
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const apiErr = await toApiError(res);
      const level = res.status >= 500 ? "error" : "warn";
      this.#log(level, {
        method,
        path,
        status: res.status,
        durationMs: Date.now() - startMs,
        requestId,
        errorMessage: apiErr.message,
      });
      throw apiErr;
    }

    this.#log("info", {
      method,
      path,
      status: res.status,
      durationMs: Date.now() - startMs,
      requestId,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  #log(
    level: "info" | "warn" | "error",
    context: Record<string, unknown>
  ): void {
    if (!this.#logger) return;
    const message =
      level === "info"
        ? "pennylane request"
        : context.status === "network"
          ? "pennylane request network error"
          : "pennylane request failed";
    this.#logger[level](message, context);
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const base = `${this.baseUrl}${normalizedPath}`;
    const qs = this.buildQueryString(query);
    return qs ? `${base}?${qs}` : base;
  }

  private buildQueryString(query: Record<string, QueryValue> | undefined) {
    if (!query) return "";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const entry of value) params.append(key, String(entry));
        continue;
      }
      params.append(key, String(value));
    }
    return params.toString();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function toApiError(
  res: Response
): Promise<
  | PennylaneAuthError
  | PennylaneForbiddenError
  | PennylaneNotFoundError
  | PennylaneValidationError
  | PennylaneServerError
> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const message = extractMessage(body, res.status);
  const context: PennylaneErrorContext = {
    status: res.status,
    pennylaneBody: body,
    code: extractString(body, "code"),
    field: extractString(body, "field"),
  };

  if (res.status === 401) return new PennylaneAuthError(message, context);
  if (res.status === 403) return new PennylaneForbiddenError(message, context);
  if (res.status === 404) return new PennylaneNotFoundError(message, context);
  if (res.status === 400 || res.status === 422) {
    return new PennylaneValidationError(message, context);
  }
  if (res.status >= 500) {
    return new PennylaneServerError(message, context);
  }
  return new PennylaneValidationError(message, context);
}

function extractMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body.error === "string") return body.error;
    if (typeof body.message === "string") return body.message;
  }
  return `Pennylane request failed with status ${status}`;
}

function extractString(body: unknown, key: string): string | undefined {
  if (!isRecord(body)) return undefined;
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function wrapNetworkError(
  err: unknown,
  timeoutMs: number
): PennylaneNetworkError {
  const fields = isRecord(err)
    ? (err as { name?: unknown; code?: unknown; message?: unknown })
    : {};
  const isAbort =
    fields.name === "AbortError" ||
    fields.code === "ABORT_ERR" ||
    fields.code === 20;
  const fallbackMessage =
    typeof fields.message === "string" ? fields.message : String(err);
  const message = isAbort
    ? `Pennylane request timed out after ${timeoutMs}ms`
    : `Pennylane request failed: ${fallbackMessage}`;
  return new PennylaneNetworkError(message, {
    status: null,
    pennylaneBody: null,
    cause: err,
  });
}
