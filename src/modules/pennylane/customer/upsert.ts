import type { OrderAddressDTO, OrderDTO } from "@medusajs/framework/types";

import type { PennylaneClient } from "../client/pennylane-client";

import {
  toPennylaneBillingAddress,
  type PennylaneBillingAddress,
} from "./address";
import { requireBillingAddressField } from "./lib";

const CALLER = "upsertPennylaneCustomer";

export type PennylaneCustomerType = "individual" | "company";

export interface UpsertPennylaneCustomerInput {
  order: OrderDTO;
  client: PennylaneClient;
  externalReferenceOverride?: string;
  metadataSirenKey?: string;
  metadataVatNumberKey?: string;
}

export interface UpsertPennylaneCustomerResult {
  customerId: number;
  externalReference: string;
  type: PennylaneCustomerType;
  action: "found" | "created";
}

const DEFAULT_SIREN_KEY = "siren";
const DEFAULT_VAT_NUMBER_KEY = "vat_number";

/**
 * Idempotent upsert of a Pennylane customer for a Medusa order.
 *
 * Looks up by `external_reference` first; creates an individual or company
 * customer based on the `billing_address.company` presence if absent.
 * See `docs/customer-upsert.md` for the full contract and the Gemini-sourced
 * French-invoicing rationale for the guest-checkout strategy.
 */
export async function upsertPennylaneCustomer(
  input: UpsertPennylaneCustomerInput
): Promise<UpsertPennylaneCustomerResult> {
  const {
    order,
    client,
    externalReferenceOverride,
    metadataSirenKey = DEFAULT_SIREN_KEY,
    metadataVatNumberKey = DEFAULT_VAT_NUMBER_KEY,
  } = input;

  const externalReference = deriveExternalReference(
    order,
    externalReferenceOverride
  );

  const existing = await lookupCustomer(client, externalReference);
  if (existing) {
    return {
      customerId: existing.id,
      externalReference,
      type: existing.type,
      action: "found",
    };
  }

  const billingAddress = order.billing_address;
  if (!billingAddress) {
    throw new Error(
      `upsertPennylaneCustomer: order ${order.id} has no billing_address`
    );
  }

  const pennylaneBillingAddress = toPennylaneBillingAddress(
    billingAddress,
    order.id
  );
  const type: PennylaneCustomerType =
    billingAddress.company && billingAddress.company.length > 0
      ? "company"
      : "individual";

  const created =
    type === "company"
      ? await createCompanyCustomer({
          client,
          order,
          billingAddress,
          pennylaneBillingAddress,
          externalReference,
          metadataSirenKey,
          metadataVatNumberKey,
        })
      : await createIndividualCustomer({
          client,
          order,
          billingAddress,
          pennylaneBillingAddress,
          externalReference,
        });

  return {
    customerId: created,
    externalReference,
    type,
    action: "created",
  };
}

/* ------------------------------------------------------------------------ */
/* Internal helpers                                                         */
/* ------------------------------------------------------------------------ */

function deriveExternalReference(
  order: OrderDTO,
  override: string | undefined
): string {
  if (override && override.length > 0) return override;
  if (order.customer_id) return `med_cust_${order.customer_id}`;
  return `med_order_${order.id}`;
}

async function lookupCustomer(
  client: PennylaneClient,
  externalReference: string
): Promise<{ id: number; type: PennylaneCustomerType } | null> {
  const filter = JSON.stringify([
    { field: "external_reference", operator: "eq", value: externalReference },
  ]);
  const response = await client.get<{ customers: unknown }>("/customers", {
    query: { filter, limit: 1 },
  });
  if (!Array.isArray(response.customers)) {
    throw new Error(
      `upsertPennylaneCustomer: unexpected GET /customers response shape (missing customers array)`
    );
  }
  const first = response.customers[0] as
    | { id?: unknown; customer_type?: unknown }
    | undefined;
  if (!first) return null;
  if (typeof first.id !== "number") {
    throw new Error(
      `upsertPennylaneCustomer: customer matched by external_reference ${externalReference} has no numeric id (got ${JSON.stringify(
        first.id
      )})`
    );
  }
  const type: PennylaneCustomerType =
    first.customer_type === "company" ? "company" : "individual";
  return { id: first.id, type };
}

async function createIndividualCustomer(params: {
  client: PennylaneClient;
  order: OrderDTO;
  billingAddress: OrderAddressDTO;
  pennylaneBillingAddress: PennylaneBillingAddress;
  externalReference: string;
}): Promise<number> {
  const {
    client,
    order,
    billingAddress,
    pennylaneBillingAddress,
    externalReference,
  } = params;

  const first_name = requireBillingAddressField(
    billingAddress.first_name,
    "first_name",
    order.id,
    CALLER
  );
  const last_name = requireBillingAddressField(
    billingAddress.last_name,
    "last_name",
    order.id,
    CALLER
  );

  const body: Record<string, unknown> = {
    first_name,
    last_name,
    external_reference: externalReference,
    billing_address: pennylaneBillingAddress,
  };
  attachOptionalString(body, "phone", billingAddress.phone);
  attachEmails(body, order.email);

  return postAndValidateId(client, "/individual_customers", body, order.id);
}

async function createCompanyCustomer(params: {
  client: PennylaneClient;
  order: OrderDTO;
  billingAddress: OrderAddressDTO;
  pennylaneBillingAddress: PennylaneBillingAddress;
  externalReference: string;
  metadataSirenKey: string;
  metadataVatNumberKey: string;
}): Promise<number> {
  const {
    client,
    order,
    billingAddress,
    pennylaneBillingAddress,
    externalReference,
    metadataSirenKey,
    metadataVatNumberKey,
  } = params;

  const name = requireBillingAddressField(
    billingAddress.company,
    "company",
    order.id,
    CALLER
  );

  const body: Record<string, unknown> = {
    name,
    external_reference: externalReference,
    billing_address: pennylaneBillingAddress,
  };
  attachOptionalString(body, "phone", billingAddress.phone);
  attachEmails(body, order.email);
  attachRecipient(body, billingAddress);

  const metadata = (order.metadata ?? {}) as Record<string, unknown>;
  attachOptionalString(body, "reg_no", metadata[metadataSirenKey]);
  attachOptionalString(body, "vat_number", metadata[metadataVatNumberKey]);

  return postAndValidateId(client, "/company_customers", body, order.id);
}

async function postAndValidateId(
  client: PennylaneClient,
  path: string,
  body: Record<string, unknown>,
  orderId: string
): Promise<number> {
  const response = await client.post<{ id?: unknown }>(path, { body });
  if (typeof response.id !== "number") {
    throw new Error(
      `upsertPennylaneCustomer: POST ${path} for order ${orderId} returned a non-numeric id (got ${JSON.stringify(
        response.id
      )})`
    );
  }
  return response.id;
}

function attachOptionalString(
  body: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (typeof value === "string" && value.length > 0) {
    body[key] = value;
  }
}

function attachEmails(body: Record<string, unknown>, email: unknown): void {
  if (typeof email === "string" && email.length > 0) {
    // Normalize casing so Pennylane's dedup (and ours on future re-syncs)
    // is consistent whether the customer typed "User@Example.COM" or
    // "user@example.com".
    body.emails = [email.toLowerCase()];
  }
}

function attachRecipient(
  body: Record<string, unknown>,
  billingAddress: OrderAddressDTO
): void {
  const parts = [billingAddress.first_name, billingAddress.last_name].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  if (parts.length > 0) {
    body.recipient = parts.join(" ");
  }
}
