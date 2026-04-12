import type { PaymentDTO, RefundDTO } from "@medusajs/framework/types";

import { stripeMapper } from "../stripe-mapper";

const makePayment = (data: unknown): PaymentDTO =>
  ({ data } as unknown as PaymentDTO);

const fakeRefund = {} as unknown as RefundDTO;

describe("stripeMapper.id", () => {
  it("is 'stripe'", () => {
    expect(stripeMapper.id).toBe("stripe");
  });
});

describe("stripeMapper.matches", () => {
  it("matches the base Stripe provider id", () => {
    expect(stripeMapper.matches("pp_stripe_stripe")).toBe(true);
  });

  it("matches Stripe variants (bancontact, ideal, blik, ...)", () => {
    expect(stripeMapper.matches("pp_stripe_stripe-bancontact")).toBe(true);
    expect(stripeMapper.matches("pp_stripe_stripe-blik")).toBe(true);
    expect(stripeMapper.matches("pp_stripe_stripe-ideal")).toBe(true);
  });

  it("matches any pp_stripe_ prefixed id (fork-friendly)", () => {
    expect(stripeMapper.matches("pp_stripe_anything_else")).toBe(true);
  });

  it("rejects non-Stripe providers", () => {
    expect(stripeMapper.matches("pp_system_default")).toBe(false);
    expect(stripeMapper.matches("pp_paypal_paypal")).toBe(false);
  });

  it("rejects unprefixed identifiers", () => {
    expect(stripeMapper.matches("stripe")).toBe(false);
    expect(stripeMapper.matches("")).toBe(false);
  });
});

describe("stripeMapper.toTransactionReference", () => {
  it("builds a transaction_reference from payment.data.id", () => {
    const ref = stripeMapper.toTransactionReference(
      makePayment({ id: "pi_3AbC123xyz" })
    );
    expect(ref).toEqual({
      banking_provider: "stripe",
      provider_field_name: "payment_id",
      provider_field_value: "pi_3AbC123xyz",
    });
  });

  it("returns null when data.id is missing", () => {
    expect(stripeMapper.toTransactionReference(makePayment({}))).toBeNull();
  });

  it("returns null when data is null", () => {
    expect(stripeMapper.toTransactionReference(makePayment(null))).toBeNull();
  });

  it("returns null when data is undefined", () => {
    expect(
      stripeMapper.toTransactionReference(
        {} as unknown as PaymentDTO
      )
    ).toBeNull();
  });

  it("returns null when data.id is a non-string value", () => {
    expect(
      stripeMapper.toTransactionReference(makePayment({ id: 42 }))
    ).toBeNull();
  });

  it("returns null when data.id is an empty string", () => {
    expect(
      stripeMapper.toTransactionReference(makePayment({ id: "" }))
    ).toBeNull();
  });
});

describe("stripeMapper.toRefundTransactionReference", () => {
  it("returns the same reference as toTransactionReference when the parent payment has a PaymentIntent id", () => {
    const payment = makePayment({ id: "pi_3AbC123xyz" });
    expect(stripeMapper.toRefundTransactionReference!(payment, fakeRefund)).toEqual(
      stripeMapper.toTransactionReference(payment)
    );
  });

  it("returns null when the parent payment's data.id is missing", () => {
    expect(
      stripeMapper.toRefundTransactionReference!(makePayment({}), fakeRefund)
    ).toBeNull();
  });
});
