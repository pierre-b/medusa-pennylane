/**
 * Asserts that a Medusa `billing_address.<subField>` value is a non-empty
 * string. Shared by `address.ts` and `upsert.ts` — both surfaces emit the same
 * diagnostic format, differing only in the caller prefix.
 */
export function requireBillingAddressField(
  value: unknown,
  subField: string,
  orderId: string,
  caller: string
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `${caller}: order ${orderId} billing_address.${subField} is missing or empty`
    );
  }
  return value;
}
