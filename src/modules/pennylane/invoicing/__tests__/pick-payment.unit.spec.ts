import type { OrderDetailDTO, PaymentDTO } from "@medusajs/framework/types";

import { pickCapturedPayment } from "../pick-payment";

const captured = (overrides: Partial<PaymentDTO> = {}): PaymentDTO =>
  ({
    id: "pay_captured",
    provider_id: "pp_stripe_stripe",
    data: { id: "pi_xyz" },
    captured_at: "2026-04-12T10:05:00.000Z",
    canceled_at: undefined,
    ...overrides,
  }) as unknown as PaymentDTO;

const uncaptured = (overrides: Partial<PaymentDTO> = {}): PaymentDTO =>
  ({
    id: "pay_uncaptured",
    provider_id: "pp_stripe_stripe",
    data: {},
    captured_at: undefined,
    canceled_at: undefined,
    ...overrides,
  }) as unknown as PaymentDTO;

const makeOrder = (
  payment_collections: Array<{ payments?: PaymentDTO[] }> | undefined
): OrderDetailDTO =>
  ({
    id: "order_01J",
    payment_collections,
  }) as unknown as OrderDetailDTO;

describe("pickCapturedPayment", () => {
  it("returns null when payment_collections is undefined", () => {
    expect(pickCapturedPayment(makeOrder(undefined))).toBeNull();
  });

  it("returns null when payment_collections is empty", () => {
    expect(pickCapturedPayment(makeOrder([]))).toBeNull();
  });

  it("returns the first captured payment across collections", () => {
    const wanted = captured({ id: "pay_winner" });
    const order = makeOrder([
      { payments: [uncaptured()] },
      { payments: [wanted, captured({ id: "pay_loser" })] },
    ]);

    expect(pickCapturedPayment(order)).toBe(wanted);
  });

  it("returns null when no payment has captured_at", () => {
    const order = makeOrder([
      { payments: [uncaptured(), uncaptured({ id: "pay_b" })] },
    ]);

    expect(pickCapturedPayment(order)).toBeNull();
  });

  it("skips payments that were captured and then canceled", () => {
    const wanted = captured({ id: "pay_winner" });
    const order = makeOrder([
      {
        payments: [
          captured({
            id: "pay_refunded",
            canceled_at: "2026-04-12T11:00:00.000Z",
          }),
          wanted,
        ],
      },
    ]);

    expect(pickCapturedPayment(order)).toBe(wanted);
  });
});
