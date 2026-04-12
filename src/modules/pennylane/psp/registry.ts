import type { PspMapper } from "./mapper";
import { BUILT_IN_PSP_MAPPERS } from "./catalogue";

export type OnUnknownPsp = "warn" | "accept" | "error";

const ON_UNKNOWN_PSP_VALUES: readonly OnUnknownPsp[] = [
  "warn",
  "accept",
  "error",
];

export interface PspMapperRegistryOptions {
  onUnknownPsp?: OnUnknownPsp;
  providerAliases?: Record<string, string>;
  disableMappers?: string[];
  customMappers?: PspMapper[];
  /** DI seam for tests; defaults to {@link BUILT_IN_PSP_MAPPERS}. */
  builtIns?: readonly PspMapper[];
}

/**
 * Resolves a Medusa `payment.provider_id` to the {@link PspMapper} that
 * knows how to build the Pennylane `transaction_reference` for that PSP.
 *
 * Resolution order (first match wins):
 *
 *   1. Alias lookup   — `providerAliases[providerId]` short-circuits normal
 *                       matching; the value must be a mapper `id` in the
 *                       effective catalogue (built-ins minus disabled + custom).
 *   2. Built-in match — iterate the shipped catalogue (minus `disableMappers`).
 *   3. Custom match   — iterate `customMappers` as a last resort. To override a
 *                       built-in, disable it via `disableMappers` first.
 *   4. `null`         — the caller applies `onUnknownPsp` policy.
 */
export class PspMapperRegistry {
  readonly onUnknownPsp: OnUnknownPsp;
  readonly providerAliases: Record<string, string>;
  private readonly builtIns: readonly PspMapper[];
  private readonly customMappers: readonly PspMapper[];
  private readonly mappersById: ReadonlyMap<string, PspMapper>;

  constructor(options: PspMapperRegistryOptions = {}) {
    this.onUnknownPsp = validateOnUnknownPsp(options.onUnknownPsp);

    const source = options.builtIns ?? BUILT_IN_PSP_MAPPERS;
    const disableMappers = options.disableMappers ?? [];
    validateDisableMappers(disableMappers, source);

    const customMappers = options.customMappers ?? [];
    customMappers.forEach(validateCustomMapper);

    const builtIns = source.filter((m) => !disableMappers.includes(m.id));
    validateUniqueIds(builtIns, customMappers);

    const providerAliases = options.providerAliases ?? {};
    validateProviderAliases(providerAliases, builtIns, customMappers);

    this.builtIns = builtIns;
    this.customMappers = customMappers;
    this.providerAliases = providerAliases;

    const byId = new Map<string, PspMapper>();
    for (const mapper of [...builtIns, ...customMappers]) {
      byId.set(mapper.id, mapper);
    }
    this.mappersById = byId;
  }

  resolve(providerId: string): PspMapper | null {
    const aliasTarget = this.providerAliases[providerId];
    if (aliasTarget !== undefined) {
      return this.mappersById.get(aliasTarget) ?? null;
    }

    const builtinMatch = this.builtIns.find((m) => m.matches(providerId));
    if (builtinMatch) return builtinMatch;

    const customMatch = this.customMappers.find((m) => m.matches(providerId));
    return customMatch ?? null;
  }
}

function validateOnUnknownPsp(value: OnUnknownPsp | undefined): OnUnknownPsp {
  if (value === undefined) return "warn";
  if (!ON_UNKNOWN_PSP_VALUES.includes(value)) {
    throw new Error(
      `PspMapperRegistry: invalid onUnknownPsp value ${JSON.stringify(value)}; expected one of ${JSON.stringify(ON_UNKNOWN_PSP_VALUES)}`
    );
  }
  return value;
}

function validateDisableMappers(
  disableMappers: string[],
  source: readonly PspMapper[]
): void {
  const knownIds = new Set(source.map((m) => m.id));
  for (const id of disableMappers) {
    if (!knownIds.has(id)) {
      throw new Error(
        `PspMapperRegistry: disableMappers references unknown mapper id ${JSON.stringify(id)}; built-in catalogue ids are ${JSON.stringify([...knownIds])}`
      );
    }
  }
}

function validateCustomMapper(mapper: unknown, index: number): void {
  if (!mapper || typeof mapper !== "object") {
    throw new Error(
      `PspMapperRegistry: customMappers[${index}] must be an object.`
    );
  }
  const m = mapper as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.length === 0) {
    throw new Error(
      `PspMapperRegistry: customMappers[${index}] is missing a non-empty string \`id\`.`
    );
  }
  if (typeof m.matches !== "function") {
    throw new Error(
      `PspMapperRegistry: customMappers[${index}] (id="${m.id}") is missing a \`matches\` function.`
    );
  }
  if (typeof m.toTransactionReference !== "function") {
    throw new Error(
      `PspMapperRegistry: customMappers[${index}] (id="${m.id}") is missing a \`toTransactionReference\` function.`
    );
  }
  if (
    m.toRefundTransactionReference !== undefined &&
    typeof m.toRefundTransactionReference !== "function"
  ) {
    throw new Error(
      `PspMapperRegistry: customMappers[${index}] (id="${m.id}") has a non-function \`toRefundTransactionReference\`.`
    );
  }
}

function validateUniqueIds(
  builtIns: readonly PspMapper[],
  customMappers: readonly PspMapper[]
): void {
  const seen = new Map<string, "built-in" | "custom">();
  for (const m of builtIns) seen.set(m.id, "built-in");
  for (const m of customMappers) {
    const existing = seen.get(m.id);
    if (existing === "built-in") {
      throw new Error(
        `PspMapperRegistry: customMappers id "${m.id}" collides with an active built-in mapper. To replace the built-in, add \`disableMappers: ["${m.id}"]\`.`
      );
    }
    if (existing === "custom") {
      throw new Error(
        `PspMapperRegistry: customMappers contains duplicate id "${m.id}".`
      );
    }
    seen.set(m.id, "custom");
  }
}

function validateProviderAliases(
  aliases: Record<string, string>,
  builtIns: readonly PspMapper[],
  customMappers: readonly PspMapper[]
): void {
  const known = new Set<string>();
  for (const m of builtIns) known.add(m.id);
  for (const m of customMappers) known.add(m.id);
  for (const [alias, target] of Object.entries(aliases)) {
    if (!known.has(target)) {
      throw new Error(
        `PspMapperRegistry: providerAliases[${JSON.stringify(alias)}] points to ${JSON.stringify(target)}, which is not a known mapper id (effective catalogue: ${JSON.stringify([...known])}).`
      );
    }
  }
}
