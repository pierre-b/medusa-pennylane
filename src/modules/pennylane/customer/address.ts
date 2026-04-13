import type { OrderAddressDTO } from "@medusajs/framework/types";

import { requireBillingAddressField } from "./lib";

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

  const CALLER = "toPennylaneBillingAddress";
  const address_1 = requireBillingAddressField(
    address.address_1,
    "address_1",
    orderId,
    CALLER
  );
  const postal_code = requireBillingAddressField(
    address.postal_code,
    "postal_code",
    orderId,
    CALLER
  );
  const city = requireBillingAddressField(
    address.city,
    "city",
    orderId,
    CALLER
  );
  const country_code = requireBillingAddressField(
    address.country_code,
    "country_code",
    orderId,
    CALLER
  );

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
