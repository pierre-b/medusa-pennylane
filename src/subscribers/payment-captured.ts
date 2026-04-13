import type { Logger } from "@medusajs/framework/types";
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework/subscribers";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { PENNYLANE_MODULE } from "../modules/pennylane";
import type PennylaneModuleService from "../modules/pennylane/service";
import type { PennylaneLogger } from "../modules/pennylane/client/pennylane-client";
import { syncOrderToPennylaneWorkflow } from "../workflows/sync-order-to-pennylane";

import {
  handlePaymentCaptured,
  type QueryLike,
} from "./handle-payment-captured";

export default async function pennylanePaymentCapturedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const service = container.resolve<PennylaneModuleService>(PENNYLANE_MODULE);
  const query = container.resolve<QueryLike>(ContainerRegistrationKeys.QUERY);
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);

  await handlePaymentCaptured({
    paymentId: event.data.id,
    autoSyncOnCapture: service.isAutoSyncOnCaptureEnabled(),
    options: service.getSyncOptions(),
    query,
    runWorkflow: (orderId, options) =>
      syncOrderToPennylaneWorkflow(container).run({
        input: { order_id: orderId, options },
      }),
    logger: toPennylaneLogger(logger),
  });
}

export const config: SubscriberConfig = { event: "payment.captured" };

function toPennylaneLogger(logger: Logger): PennylaneLogger {
  const format = (message: string, context?: Record<string, unknown>) =>
    context ? `${message} ${JSON.stringify(context)}` : message;
  return {
    info: (message, context) => logger.info(format(message, context)),
    warn: (message, context) => logger.warn(format(message, context)),
    error: (message, context) => logger.error(format(message, context)),
  };
}
