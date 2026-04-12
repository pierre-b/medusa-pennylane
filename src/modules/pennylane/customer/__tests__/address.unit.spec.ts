import type { OrderAddressDTO } from "@medusajs/framework/types";

import { toPennylaneBillingAddress } from "../address";

const addr = (overrides: Partial<OrderAddressDTO> = {}): OrderAddressDTO =>
  ({
    id: "addr_1",
    created_at: "2026-04-12T00:00:00.000Z",
    updated_at: "2026-04-12T00:00:00.000Z",
    address_1: "12 rue du Commerce",
    postal_code: "75015",
    city: "Paris",
    country_code: "fr",
    ...overrides,
  }) as OrderAddressDTO;

describe("toPennylaneBillingAddress", () => {
  it("maps a minimal valid address and uppercases the country code", () => {
    const result = toPennylaneBillingAddress(addr(), "order_1");
    expect(result).toEqual({
      address: "12 rue du Commerce",
      postal_code: "75015",
      city: "Paris",
      country_alpha2: "FR",
    });
  });

  it("joins address_1 and address_2 with a comma when both are non-empty", () => {
    const result = toPennylaneBillingAddress(
      addr({ address_2: "Apt 4B" }),
      "order_1"
    );
    expect(result.address).toBe("12 rue du Commerce, Apt 4B");
  });

  it("ignores address_2 when it is empty", () => {
    const result = toPennylaneBillingAddress(
      addr({ address_2: "" }),
      "order_1"
    );
    expect(result.address).toBe("12 rue du Commerce");
  });

  it("throws with order id when address_1 is missing", () => {
    expect(() =>
      toPennylaneBillingAddress(addr({ address_1: undefined }), "order_xyz")
    ).toThrow(/order_xyz.*address_1/i);
  });

  it("throws when postal_code is missing", () => {
    expect(() =>
      toPennylaneBillingAddress(addr({ postal_code: undefined }), "order_1")
    ).toThrow(/postal_code/);
  });

  it("throws when city is missing", () => {
    expect(() =>
      toPennylaneBillingAddress(addr({ city: undefined }), "order_1")
    ).toThrow(/city/);
  });

  it("throws when country_code is missing", () => {
    expect(() =>
      toPennylaneBillingAddress(addr({ country_code: undefined }), "order_1")
    ).toThrow(/country_code/);
  });

  it("throws when address is null or undefined", () => {
    expect(() => toPennylaneBillingAddress(null, "order_1")).toThrow(
      /billing_address/
    );
    expect(() => toPennylaneBillingAddress(undefined, "order_1")).toThrow(
      /billing_address/
    );
  });

  it("treats empty strings as missing required fields", () => {
    expect(() =>
      toPennylaneBillingAddress(addr({ address_1: "" }), "order_1")
    ).toThrow(/address_1/);
    expect(() =>
      toPennylaneBillingAddress(addr({ postal_code: "" }), "order_1")
    ).toThrow(/postal_code/);
  });
});
