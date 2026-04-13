import type { OrderDetailDTO, PaymentDTO } from "@medusajs/framework/types";

/**
 * Picks the first payment on the order that was captured and not canceled.
 *
 * Medusa's canonical "this payment was captured" signal is `captured_at`
 * (non-null). `canceled_at` overrides: a captured-then-canceled payment is
 * not a current charge and must not be used to produce an invoice.
 *
 * Requires an `OrderDetailDTO` (order with `payment_collections` populated);
 * D3 fetches with the necessary relations via `useQueryGraphStep`.
 */
export function pickCapturedPayment(order: OrderDetailDTO): PaymentDTO | null {
  const collections = order.payment_collections;
  if (!Array.isArray(collections) || collections.length === 0) return null;

  for (const collection of collections) {
    const payments = collection?.payments;
    if (!Array.isArray(payments)) continue;
    for (const payment of payments) {
      if (isCapturedAndActive(payment)) return payment;
    }
  }
  return null;
}

function isCapturedAndActive(payment: PaymentDTO): boolean {
  return Boolean(payment?.captured_at) && !payment.canceled_at;
}
