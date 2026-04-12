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
  private readonly apiToken_: string;
  private readonly logger_: PennylaneLogger | undefined;

  constructor(params: PennylaneClientParams) {
    if (!params?.apiToken || typeof params.apiToken !== "string") {
      throw new Error(
        "PennylaneClient: `apiToken` is required (received none)."
      );
    }
    this.apiToken_ = params.apiToken;
    this.baseUrl = (params.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.requestTimeoutMs =
      params.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.logger_ = params.logger;
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

  delete<T>(
    path: string,
    opts: Omit<RequestOptions, "body"> = {}
  ): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken_}`,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, init);

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
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
