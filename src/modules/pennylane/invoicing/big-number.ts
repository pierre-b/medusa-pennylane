import type { BigNumberValue } from "@medusajs/framework/types";

/**
 * Coerces a Medusa `BigNumberValue` to a plain `number`.
 *
 * Medusa wraps amounts in a polymorphic type that may be:
 *   - a plain `number`
 *   - a numeric string ("12.50")
 *   - a BigNumber instance with a `.toNumber()` method
 *   - an `IBigNumber`-shaped object with a `.numeric` property
 *
 * This helper unwraps all four shapes. Never uses the `.raw_` field (marked
 * `@ignore` in Medusa's typings).
 *
 * Throws with a descriptive message on NaN, Infinity, un-parseable strings,
 * and unknown object shapes — so a bad order from an unexpected Medusa
 * version surfaces loudly at the D1 boundary rather than producing a silent
 * NaN that would corrupt the downstream invoice.
 */
export function unwrapBigNumber(value: BigNumberValue): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`unwrapBigNumber: non-finite number ${value}`);
    }
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        `unwrapBigNumber: cannot parse string ${JSON.stringify(value)}`
      );
    }
    return parsed;
  }
  if (value && typeof value === "object") {
    const maybeNumeric = (value as { numeric?: unknown }).numeric;
    if (typeof maybeNumeric === "number" && Number.isFinite(maybeNumeric)) {
      return maybeNumeric;
    }
    const maybeToNumber = (value as { toNumber?: unknown }).toNumber;
    if (typeof maybeToNumber === "function") {
      const result = (maybeToNumber as () => unknown).call(value);
      if (typeof result === "number" && Number.isFinite(result)) {
        return result;
      }
    }
  }
  throw new Error(
    `unwrapBigNumber: cannot unwrap value of type ${typeof value} with shape ${JSON.stringify(value)}`
  );
}
