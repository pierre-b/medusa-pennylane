import type { PspMapper } from "./mapper";

const STRIPE_PROVIDER_PREFIX = "pp_stripe_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const stripeMapper: PspMapper = {
  id: "stripe",

  matches(providerId) {
    return providerId.startsWith(STRIPE_PROVIDER_PREFIX);
  },

  toTransactionReference(payment) {
    if (!isRecord(payment.data)) return null;
    const id = payment.data.id;
    if (typeof id !== "string" || id.length === 0) return null;
    return {
      banking_provider: "stripe",
      provider_field_name: "payment_id",
      provider_field_value: id,
    };
  },

  toRefundTransactionReference(payment, _refund) {
    // Stripe reconciles refunds against the parent PaymentIntent server-side,
    // so the refund's transaction_reference is the same as the payment's.
    return this.toTransactionReference(payment);
  },
};
