import type { PennylaneLogger } from "../modules/pennylane/client/pennylane-client";
import type { SyncOrderToPennylaneOptions } from "../modules/pennylane/invoicing/sync-order";

export interface QueryLike {
  graph<T = unknown>(params: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
  }): Promise<{ data: T[] }>;
}

export interface HandlePaymentCapturedInput {
  paymentId: string;
  autoSyncOnCapture: boolean;
  options: SyncOrderToPennylaneOptions;
  query: QueryLike;
  runWorkflow: (
    orderId: string,
    options: SyncOrderToPennylaneOptions
  ) => Promise<unknown>;
  logger: PennylaneLogger;
}

export type HandlePaymentCapturedOutcome =
  | { skipped: true; reason: "opt_out" | "no_order" | "lookup_failed" }
  | { skipped: false; orderId: string; error: string | null };

interface PaymentLookupRow {
  id?: string;
  payment_collection?: { id?: string; order?: { id?: string } };
}

const LAST_ERROR_MAX_LEN = 1000;

/**
 * Pure orchestration of the payment.captured subscriber. Resolves the
 * captured payment's order id and invokes the sync workflow. Never throws;
 * all failures end in a structured outcome + an ERROR log.
 */
export async function handlePaymentCaptured(
  input: HandlePaymentCapturedInput
): Promise<HandlePaymentCapturedOutcome> {
  const { paymentId, autoSyncOnCapture, options, query, runWorkflow, logger } =
    input;

  if (!autoSyncOnCapture) {
    logger.info(
      `Pennylane auto-sync is disabled; skipping payment ${paymentId}`
    );
    return { skipped: true, reason: "opt_out" };
  }

  let payment: PaymentLookupRow | undefined;
  try {
    const { data } = await query.graph<PaymentLookupRow>({
      entity: "payment",
      fields: ["id", "payment_collection.order.id"],
      filters: { id: paymentId },
    });
    payment = data[0];
  } catch (err) {
    logger.error(
      `Pennylane subscriber failed to look up payment ${paymentId}: ${formatError(err)}`
    );
    return { skipped: true, reason: "lookup_failed" };
  }

  const orderId = payment?.payment_collection?.order?.id;
  if (typeof orderId !== "string" || orderId.length === 0) {
    logger.info(
      `Payment ${paymentId} has no linked order; skipping Pennylane sync`
    );
    return { skipped: true, reason: "no_order" };
  }

  try {
    await runWorkflow(orderId, options);
    return { skipped: false, orderId, error: null };
  } catch (err) {
    const error = formatError(err);
    logger.error(
      `Pennylane sync failed for order ${orderId} (payment ${paymentId}): ${error}`
    );
    return { skipped: false, orderId, error };
  }
}

function formatError(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw.length > LAST_ERROR_MAX_LEN
    ? raw.slice(0, LAST_ERROR_MAX_LEN)
    : raw;
}
