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

export interface RequestOptions {
  query?: Record<
    string,
    string | number | boolean | readonly (string | number)[] | undefined
  >;
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
}
