import type { PennylaneClient } from "../client/pennylane-client";

import type { PennylaneInvoiceCreatePayload } from "./invoice-payload";

export interface CreatePennylaneInvoiceInput {
  payload: PennylaneInvoiceCreatePayload;
  client: PennylaneClient;
  orderId: string;
}

export interface CreatePennylaneInvoiceResult {
  invoiceId: number;
  externalReference: string;
  action: "created" | "idempotent";
}

/**
 * Posts a pre-built invoice payload (D1 output) to Pennylane with an
 * idempotent pre-check on `external_reference`. See `docs/invoice-create.md`
 * for the full contract.
 */
export async function createPennylaneInvoice(
  input: CreatePennylaneInvoiceInput
): Promise<CreatePennylaneInvoiceResult> {
  const { payload, client, orderId } = input;
  const externalReference = payload.external_reference;

  const existing = await lookupInvoice(client, externalReference, orderId);
  if (existing !== null) {
    return {
      invoiceId: existing,
      externalReference,
      action: "idempotent",
    };
  }

  const response = await client.post<{ id?: unknown }>("/customer_invoices", {
    body: payload,
  });
  if (typeof response.id !== "number") {
    throw new Error(
      `createPennylaneInvoice: POST /customer_invoices for order ${orderId} returned a non-numeric id (got ${JSON.stringify(
        response.id
      )})`
    );
  }
  return {
    invoiceId: response.id,
    externalReference,
    action: "created",
  };
}

async function lookupInvoice(
  client: PennylaneClient,
  externalReference: string,
  orderId: string
): Promise<number | null> {
  const filter = JSON.stringify([
    { field: "external_reference", operator: "eq", value: externalReference },
  ]);
  const response = await client.get<{ items: unknown }>("/customer_invoices", {
    query: { filter, limit: 1 },
  });
  if (!Array.isArray(response.items)) {
    throw new Error(
      `createPennylaneInvoice: unexpected GET /customer_invoices response shape (missing items array) for order ${orderId}`
    );
  }
  const first = response.items[0] as { id?: unknown } | undefined;
  if (!first) return null;
  if (typeof first.id !== "number") {
    throw new Error(
      `createPennylaneInvoice: invoice matched by external_reference ${externalReference} has no numeric id (got ${JSON.stringify(
        first.id
      )}) for order ${orderId}`
    );
  }
  return first.id;
}
