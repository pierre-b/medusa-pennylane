import { MedusaService } from "@medusajs/framework/utils";
import type { Logger } from "@medusajs/framework/types";

import InvoiceSync from "./models/invoice-sync";
import CustomerSync from "./models/customer-sync";
import { PennylaneClient } from "./client/pennylane-client";
import type { MeResponse, PennylaneLogger } from "./client/pennylane-client";
import type { SyncOrderToPennylaneOptions } from "./invoicing/sync-order";
import { PspMapperRegistry } from "./psp/registry";
import type { PennylaneModuleOptions } from "./types";

type InjectedDependencies = { logger: Logger };

const DEFAULTS = {
  autoSyncOnCapture: true,
  vatMetadataKey: "pennylane_vat_rate",
  defaultShippingVatRate: "FR_200",
  itemUnit: "piece",
  shippingUnit: "forfait",
  metadataSirenKey: "siren",
  metadataVatNumberKey: "vat_number",
  onUnknownPsp: "warn" as const,
};

class PennylaneModuleService extends MedusaService({
  InvoiceSync,
  CustomerSync,
}) {
  protected readonly client_: PennylaneClient;
  protected readonly pspRegistry_: PspMapperRegistry;
  protected readonly logger_: Logger;
  protected readonly autoSyncOnCapture_: boolean;
  protected readonly syncOptions_: Readonly<SyncOrderToPennylaneOptions>;

  constructor(deps: InjectedDependencies, options: PennylaneModuleOptions) {
    if (!options?.apiToken || typeof options.apiToken !== "string") {
      throw new Error(
        "medusa-plugin-pennylane: required option `apiToken` is missing."
      );
    }
    // eslint-disable-next-line prefer-rest-params
    super(...arguments);
    this.logger_ = deps.logger;
    this.client_ = new PennylaneClient({
      apiToken: options.apiToken,
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      logger: toPennylaneLogger(deps.logger),
    });
    this.pspRegistry_ = new PspMapperRegistry({
      onUnknownPsp: options.onUnknownPsp,
      providerAliases: options.providerAliases,
      disableMappers: options.disableMappers,
      customMappers: options.customMappers,
    });
    this.autoSyncOnCapture_ =
      options.autoSyncOnCapture ?? DEFAULTS.autoSyncOnCapture;
    this.syncOptions_ = Object.freeze({
      vatMetadataKey: options.vatMetadataKey ?? DEFAULTS.vatMetadataKey,
      defaultShippingVatRate:
        options.defaultShippingVatRate ?? DEFAULTS.defaultShippingVatRate,
      onUnknownPsp: options.onUnknownPsp ?? DEFAULTS.onUnknownPsp,
      itemUnit: options.itemUnit ?? DEFAULTS.itemUnit,
      shippingUnit: options.shippingUnit ?? DEFAULTS.shippingUnit,
      metadataSirenKey: options.metadataSirenKey ?? DEFAULTS.metadataSirenKey,
      metadataVatNumberKey:
        options.metadataVatNumberKey ?? DEFAULTS.metadataVatNumberKey,
    });
  }

  getClient(): PennylaneClient {
    return this.client_;
  }

  getPspRegistry(): PspMapperRegistry {
    return this.pspRegistry_;
  }

  isAutoSyncOnCaptureEnabled(): boolean {
    return this.autoSyncOnCapture_;
  }

  getSyncOptions(): SyncOrderToPennylaneOptions {
    return this.syncOptions_;
  }

  healthCheck(): Promise<MeResponse> {
    return this.client_.healthCheck();
  }
}

function toPennylaneLogger(logger: Logger): PennylaneLogger {
  const format = (message: string, context?: Record<string, unknown>) =>
    context ? `${message} ${JSON.stringify(context)}` : message;
  return {
    info: (message, context) => logger.info(format(message, context)),
    warn: (message, context) => logger.warn(format(message, context)),
    error: (message, context) => logger.error(format(message, context)),
  };
}

export default PennylaneModuleService;
