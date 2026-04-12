import type { OrderAddressDTO } from "@medusajs/framework/types";

export interface PennylaneBillingAddress {
  address: string;
  postal_code: string;
  city: string;
  country_alpha2: string;
}

/**
 * Maps a Medusa `OrderAddressDTO` to the `billing_address` shape Pennylane
 * requires on `POST /individual_customers` and `POST /company_customers`.
 *
 * Throws with `orderId` context whenever the input is absent or a required
 * field is missing/empty — French invoicing requires a complete address on
 * every invoice, and failing loudly at build time is far better than silently
 * emitting an incomplete invoice.
 */
export function toPennylaneBillingAddress(
  address: OrderAddressDTO | null | undefined,
  orderId: string
): PennylaneBillingAddress {
  if (!address) {
    throw new Error(
      `toPennylaneBillingAddress: order ${orderId} has no billing_address`
    );
  }

  const address_1 = nonEmpty(address.address_1, "address_1", orderId);
  const postal_code = nonEmpty(address.postal_code, "postal_code", orderId);
  const city = nonEmpty(address.city, "city", orderId);
  const country_code = nonEmpty(address.country_code, "country_code", orderId);

  const address_2 =
    typeof address.address_2 === "string" && address.address_2.length > 0
      ? address.address_2
      : null;

  return {
    address: address_2 ? `${address_1}, ${address_2}` : address_1,
    postal_code,
    city,
    country_alpha2: country_code.toUpperCase(),
  };
}

function nonEmpty(
  value: string | undefined,
  field: string,
  orderId: string
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `toPennylaneBillingAddress: order ${orderId} billing_address.${field} is missing or empty`
    );
  }
  return value;
}
