import type { PspMapper, TransactionReference } from "./mapper";

const STRIPE_PROVIDER_PREFIX = "pp_stripe_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractStripePaymentIntentRef(
  data: unknown
): TransactionReference | null {
  if (!isRecord(data)) return null;
  const id = data.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return {
    banking_provider: "stripe",
    provider_field_name: "payment_id",
    provider_field_value: id,
  };
}

export const stripeMapper: PspMapper = {
  id: "stripe",

  matches(providerId) {
    return providerId.startsWith(STRIPE_PROVIDER_PREFIX);
  },

  toTransactionReference(payment) {
    return extractStripePaymentIntentRef(payment.data);
  },

  // Stripe reconciles refunds against the parent PaymentIntent server-side,
  // so the refund's transaction_reference is the same as the payment's.
  // Do not delegate via `this.toTransactionReference` — keeps the method
  // correct even if the object is destructured.
  toRefundTransactionReference(payment, _refund) {
    return extractStripePaymentIntentRef(payment.data);
  },
};
