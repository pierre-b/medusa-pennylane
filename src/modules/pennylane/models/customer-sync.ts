import { model } from "@medusajs/framework/utils";

export type CustomerSyncType = "individual" | "company";

const CustomerSync = model.define("pennylane_customer_sync", {
  id: model.id().primaryKey(),
  medusa_customer_id: model.text().unique(),
  pennylane_customer_id: model.text(),
  type: model.enum(["individual", "company"]),
});

export default CustomerSync;
