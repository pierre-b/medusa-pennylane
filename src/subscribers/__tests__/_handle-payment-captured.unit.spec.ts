import type { PennylaneLogger } from "../../modules/pennylane/client/pennylane-client";
import type { SyncOrderToPennylaneOptions } from "../../modules/pennylane/invoicing/sync-order";

import {
  handlePaymentCaptured,
  type QueryLike,
} from "../_handle-payment-captured";

const silentLogger: PennylaneLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const makeLogger = (): jest.Mocked<PennylaneLogger> => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const makeOptions = (): SyncOrderToPennylaneOptions => ({
  vatMetadataKey: "pennylane_vat_rate",
  defaultShippingVatRate: "FR_200",
  onUnknownPsp: "warn",
});

const makeQuery = (data: unknown[]): jest.Mocked<QueryLike> =>
  ({
    graph: jest.fn().mockResolvedValue({ data }),
  }) as jest.Mocked<QueryLike>;

describe("handlePaymentCaptured", () => {
  it("returns skipped:opt_out when autoSyncOnCapture is disabled", async () => {
    const query = makeQuery([]);
    const runWorkflow = jest.fn();

    const result = await handlePaymentCaptured({
      paymentId: "pay_1",
      autoSyncOnCapture: false,
      options: makeOptions(),
      query,
      runWorkflow,
      logger: silentLogger,
    });

    expect(result).toEqual({ skipped: true, reason: "opt_out" });
    expect(query.graph).not.toHaveBeenCalled();
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("resolves payment → order and invokes the workflow", async () => {
    const query = makeQuery([
      { id: "pay_1", payment_collection: { order: { id: "order_42" } } },
    ]);
    const runWorkflow = jest.fn().mockResolvedValue({ result: "ok" });
    const options = makeOptions();

    const result = await handlePaymentCaptured({
      paymentId: "pay_1",
      autoSyncOnCapture: true,
      options,
      query,
      runWorkflow,
      logger: silentLogger,
    });

    expect(result).toEqual({
      skipped: false,
      orderId: "order_42",
      error: null,
    });
    expect(query.graph).toHaveBeenCalledWith({
      entity: "payment",
      fields: ["id", "payment_collection.order.id"],
      filters: { id: "pay_1" },
    });
    expect(runWorkflow).toHaveBeenCalledWith("order_42", options);
  });

  it("skips with reason no_order when payment has no payment_collection link", async () => {
    const query = makeQuery([{ id: "pay_1" }]);
    const runWorkflow = jest.fn();
    const logger = makeLogger();

    const result = await handlePaymentCaptured({
      paymentId: "pay_1",
      autoSyncOnCapture: true,
      options: makeOptions(),
      query,
      runWorkflow,
      logger,
    });

    expect(result).toEqual({ skipped: true, reason: "no_order" });
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("skips with reason no_order when payment_collection has no linked order", async () => {
    const query = makeQuery([
      { id: "pay_1", payment_collection: { id: "paycol_1" } },
    ]);
    const runWorkflow = jest.fn();

    const result = await handlePaymentCaptured({
      paymentId: "pay_1",
      autoSyncOnCapture: true,
      options: makeOptions(),
      query,
      runWorkflow,
      logger: silentLogger,
    });

    expect(result).toEqual({ skipped: true, reason: "no_order" });
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it("skips with reason lookup_failed when query.graph throws; logs error; does not throw", async () => {
    const query = {
      graph: jest.fn().mockRejectedValue(new Error("db unavailable")),
    } as jest.Mocked<QueryLike>;
    const runWorkflow = jest.fn();
    const logger = makeLogger();

    const result = await handlePaymentCaptured({
      paymentId: "pay_1",
      autoSyncOnCapture: true,
      options: makeOptions(),
      query,
      runWorkflow,
      logger,
    });

    expect(result).toEqual({ skipped: true, reason: "lookup_failed" });
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("db unavailable")
    );
  });

  it("returns the error but does not throw when the workflow throws", async () => {
    const query = makeQuery([
      { id: "pay_1", payment_collection: { order: { id: "order_42" } } },
    ]);
    const runWorkflow = jest.fn().mockRejectedValue(new Error("boom"));
    const logger = makeLogger();

    const result = await handlePaymentCaptured({
      paymentId: "pay_1",
      autoSyncOnCapture: true,
      options: makeOptions(),
      query,
      runWorkflow,
      logger,
    });

    expect(result).toMatchObject({
      skipped: false,
      orderId: "order_42",
    });
    expect((result as { error: string }).error).toContain("boom");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("order_42")
    );
  });
});
