import type { PspMapper } from "./psp/mapper";
import type { OnUnknownPsp } from "./psp/registry";

export interface PennylaneModuleOptions {
  apiToken: string;
  baseUrl?: string;
  requestTimeoutMs?: number;

  // PSP mapper registry (features P1 + P2)
  onUnknownPsp?: OnUnknownPsp;
  providerAliases?: Record<string, string>;
  disableMappers?: string[];
  customMappers?: PspMapper[];
}
