import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { useQueryGraphStep } from "@medusajs/medusa/core-flows";
import type { OrderDetailDTO } from "@medusajs/framework/types";

import { PENNYLANE_MODULE } from "../modules/pennylane";
import type PennylaneModuleService from "../modules/pennylane/service";
import {
  syncOrderToPennylane,
  type InvoiceSyncRepo,
  type SyncOrderToPennylaneOptions,
  type SyncOrderToPennylaneResult,
} from "../modules/pennylane/invoicing/sync-order";

export interface SyncOrderToPennylaneWorkflowInput {
  order_id: string;
  options: SyncOrderToPennylaneOptions;
}

interface RunSyncStepInput {
  order: OrderDetailDTO;
  options: SyncOrderToPennylaneOptions;
}

const runSyncStep = createStep(
  "run-pennylane-sync",
  async (
    { order, options }: RunSyncStepInput,
    { container }
  ): Promise<StepResponse<SyncOrderToPennylaneResult>> => {
    const service = container.resolve<PennylaneModuleService>(PENNYLANE_MODULE);

    const result = await syncOrderToPennylane({
      order,
      client: service.getClient(),
      pspRegistry: service.getPspRegistry(),
      invoiceSyncs: service as unknown as InvoiceSyncRepo,
      options,
    });

    return new StepResponse(result);
  }
);

const ORDER_FIELDS = [
  "id",
  "display_id",
  "currency_code",
  "created_at",
  "customer_id",
  "email",
  "metadata",
  "billing_address.*",
  "items.*",
  "items.metadata",
  "shipping_methods.*",
  "payment_collections.*",
  "payment_collections.payments.*",
];

export const syncOrderToPennylaneWorkflow = createWorkflow(
  "sync-order-to-pennylane",
  ({ order_id, options }: SyncOrderToPennylaneWorkflowInput) => {
    const orderQuery = useQueryGraphStep({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: { id: order_id },
      options: { throwIfKeyNotFound: true },
    });

    const result = runSyncStep({
      order: orderQuery.data[0] as unknown as OrderDetailDTO,
      options,
    });

    return new WorkflowResponse(result);
  }
);

export default syncOrderToPennylaneWorkflow;
