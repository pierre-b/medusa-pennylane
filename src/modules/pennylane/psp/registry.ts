import type { PspMapper } from "./mapper";
import { BUILT_IN_PSP_MAPPERS } from "./catalogue";

export type OnUnknownPsp = "warn" | "accept" | "error";

export interface PspMapperRegistryOptions {
  onUnknownPsp?: OnUnknownPsp;
  providerAliases?: Record<string, string>;
  disableMappers?: string[];
  customMappers?: PspMapper[];
  builtIns?: readonly PspMapper[];
}

export class PspMapperRegistry {
  readonly onUnknownPsp: OnUnknownPsp = "warn";
  readonly providerAliases: Record<string, string> = {};
  // Behaviour added incrementally via TDD cycles.

  constructor(_options: PspMapperRegistryOptions = {}) {
    // Intentionally empty for the stub phase; cycles fill this in.
    void BUILT_IN_PSP_MAPPERS;
  }

  resolve(_providerId: string): PspMapper | null {
    return null;
  }
}
