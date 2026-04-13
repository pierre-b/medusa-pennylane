import type { OrderDetailDTO } from "@medusajs/framework/types";

import type { PennylaneClient } from "../client/pennylane-client";
import type { PspMapperRegistry, OnUnknownPsp } from "../psp/registry";
import { upsertPennylaneCustomer } from "../customer/upsert";

import { buildInvoicePayload } from "./invoice-payload";
import { createPennylaneInvoice } from "./create-invoice";
import { pickCapturedPayment } from "./pick-payment";

export interface InvoiceSyncRow {
  id: string;
  status: "pending" | "syncing" | "synced" | "failed";
  pennylane_invoice_id: string | null;
  external_reference: string;
  last_error: string | null;
}

export interface InvoiceSyncRepo {
  listInvoiceSyncs(filters: {
    medusa_order_id: string;
  }): Promise<InvoiceSyncRow[]>;
  createInvoiceSyncs(data: {
    medusa_order_id: string;
    external_reference: string;
    status: "syncing";
  }): Promise<{ id: string }>;
  updateInvoiceSyncs(data: {
    id: string;
    status?: "syncing" | "synced" | "failed";
    pennylane_invoice_id?: string | null;
    last_error?: string | null;
  }): Promise<unknown>;
}

export interface SyncOrderToPennylaneOptions {
  // C1 options
  metadataSirenKey?: string;
  metadataVatNumberKey?: string;
  externalReferenceOverride?: string;
  // D1 options
  vatMetadataKey: string;
  defaultShippingVatRate: string;
  onUnknownPsp: OnUnknownPsp;
  itemUnit?: string;
  shippingUnit?: string;
}

export interface SyncOrderToPennylaneInput {
  order: OrderDetailDTO;
  client: PennylaneClient;
  pspRegistry: PspMapperRegistry;
  invoiceSyncs: InvoiceSyncRepo;
  options: SyncOrderToPennylaneOptions;
}

export interface SyncOrderToPennylaneResult {
  invoiceSyncId: string;
  pennylaneInvoiceId: number;
  pennylaneCustomerId: number | null;
  externalReference: string;
  action: "created" | "idempotent" | "already-synced";
  warnings: string[];
}

const LAST_ERROR_MAX_LEN = 1000;

/**
 * End-to-end order → Pennylane sync. See `docs/sync-order-workflow.md` for
 * the full contract, idempotency semantics, and failure handling.
 */
export async function syncOrderToPennylane(
  input: SyncOrderToPennylaneInput
): Promise<SyncOrderToPennylaneResult> {
  const { order, client, pspRegistry, invoiceSyncs, options } = input;
  const externalReference = String(order.display_id);

  const existing = await loadExisting(invoiceSyncs, order.id);

  if (
    existing &&
    existing.status === "synced" &&
    existing.pennylane_invoice_id !== null
  ) {
    return {
      invoiceSyncId: existing.id,
      pennylaneInvoiceId: Number(existing.pennylane_invoice_id),
      pennylaneCustomerId: null,
      externalReference,
      action: "already-synced",
      warnings: [],
    };
  }

  const invoiceSyncId = await upsertSyncingRow(
    invoiceSyncs,
    existing,
    order.id,
    externalReference
  );

  try {
    const payment = pickCapturedPayment(order);
    const pspMapper = payment ? pspRegistry.resolve(payment.provider_id) : null;

    const customerResult = await upsertPennylaneCustomer({
      order,
      client,
      externalReferenceOverride: options.externalReferenceOverride,
      metadataSirenKey: options.metadataSirenKey,
      metadataVatNumberKey: options.metadataVatNumberKey,
    });

    const { payload, warnings } = buildInvoicePayload({
      order,
      customerId: customerResult.customerId,
      payment,
      pspMapper,
      options: {
        vatMetadataKey: options.vatMetadataKey,
        defaultShippingVatRate: options.defaultShippingVatRate,
        onUnknownPsp: options.onUnknownPsp,
        itemUnit: options.itemUnit,
        shippingUnit: options.shippingUnit,
      },
    });

    const invoiceResult = await createPennylaneInvoice({
      payload,
      client,
      orderId: order.id,
    });

    await invoiceSyncs.updateInvoiceSyncs({
      id: invoiceSyncId,
      status: "synced",
      pennylane_invoice_id: String(invoiceResult.invoiceId),
      last_error: null,
    });

    return {
      invoiceSyncId,
      pennylaneInvoiceId: invoiceResult.invoiceId,
      pennylaneCustomerId: customerResult.customerId,
      externalReference,
      action: invoiceResult.action,
      warnings,
    };
  } catch (err) {
    await invoiceSyncs.updateInvoiceSyncs({
      id: invoiceSyncId,
      status: "failed",
      last_error: formatError(err),
    });
    throw err;
  }
}

async function loadExisting(
  repo: InvoiceSyncRepo,
  orderId: string
): Promise<InvoiceSyncRow | null> {
  const rows = await repo.listInvoiceSyncs({ medusa_order_id: orderId });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function upsertSyncingRow(
  repo: InvoiceSyncRepo,
  existing: InvoiceSyncRow | null,
  medusaOrderId: string,
  externalReference: string
): Promise<string> {
  if (existing) {
    await repo.updateInvoiceSyncs({
      id: existing.id,
      status: "syncing",
      last_error: null,
    });
    return existing.id;
  }
  const created = await repo.createInvoiceSyncs({
    medusa_order_id: medusaOrderId,
    external_reference: externalReference,
    status: "syncing",
  });
  return created.id;
}

function formatError(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw.length > LAST_ERROR_MAX_LEN
    ? raw.slice(0, LAST_ERROR_MAX_LEN)
    : raw;
}
