import { model } from "@medusajs/framework/utils";

export type InvoiceSyncStatus = "pending" | "syncing" | "synced" | "failed";

const InvoiceSync = model.define("pennylane_invoice_sync", {
  id: model.id().primaryKey(),
  medusa_order_id: model.text().unique(),
  pennylane_invoice_id: model.text().nullable(),
  external_reference: model.text(),
  status: model
    .enum(["pending", "syncing", "synced", "failed"])
    .default("pending"),
  last_error: model.text().nullable(),
});

export default InvoiceSync;
