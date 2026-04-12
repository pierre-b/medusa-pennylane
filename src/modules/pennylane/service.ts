import { MedusaService } from "@medusajs/framework/utils";
import InvoiceSync from "./models/invoice-sync";
import CustomerSync from "./models/customer-sync";

class PennylaneModuleService extends MedusaService({
  InvoiceSync,
  CustomerSync,
}) {}

export default PennylaneModuleService;
