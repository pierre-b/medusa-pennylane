import type { OrderDTO, PaymentDTO } from "@medusajs/framework/types";

import type { PspMapper, TransactionReference } from "../psp/mapper";
import type { OnUnknownPsp } from "../psp/registry";

import { centsToPennylaneDecimal, toMinorUnits } from "./amounts";
import { unwrapBigNumber } from "./big-number";
import {
  reconcileInvoiceLineTotals,
  type ReconcilableInvoiceLine,
} from "./reconcile";

export interface BuildInvoicePayloadOptions {
  vatMetadataKey: string;
  defaultShippingVatRate: string;
  onUnknownPsp: OnUnknownPsp;
  itemUnit?: string;
  shippingUnit?: string;
}

export interface BuildInvoicePayloadInput {
  order: OrderDTO;
  customerId: number;
  payment: PaymentDTO | null;
  pspMapper: PspMapper | null;
  options: BuildInvoicePayloadOptions;
}

export interface PennylaneInvoiceLinePayload {
  label: string;
  quantity: number;
  raw_currency_unit_price: string;
  unit: string;
  vat_rate: string;
}

export interface PennylaneInvoiceCreatePayload {
  date: string;
  deadline: string;
  customer_id: number;
  external_reference: string;
  currency: string;
  draft: false;
  transaction_reference?: TransactionReference;
  invoice_lines: PennylaneInvoiceLinePayload[];
  label?: string;
}

export interface BuildInvoicePayloadOutput {
  payload: PennylaneInvoiceCreatePayload;
  warnings: string[];
}

const DEFAULT_ITEM_UNIT = "piece";
const DEFAULT_SHIPPING_UNIT = "forfait";
const DEFAULT_SHIPPING_LABEL = "Livraison";

/**
 * Transforms a Medusa order into the body of Pennylane's
 * `POST /customer_invoices` (Finalized branch). See `docs/invoice-payload.md`
 * for the full contract and worked examples.
 */
export function buildInvoicePayload(
  input: BuildInvoicePayloadInput
): BuildInvoicePayloadOutput {
  const { order, customerId, payment, pspMapper, options } = input;

  const items = (order.items ?? []) as OrderItemShape[];
  if (items.length === 0) {
    throw new Error(`buildInvoicePayload: order ${order.id} has no items`);
  }

  const currency = String(order.currency_code ?? "EUR").toUpperCase();
  const itemUnit = options.itemUnit ?? DEFAULT_ITEM_UNIT;
  const shippingUnit = options.shippingUnit ?? DEFAULT_SHIPPING_UNIT;

  const itemLines = items.map((rawItem) =>
    buildItemLine(rawItem, currency, options, order.id, itemUnit)
  );

  const shippingMethods = (order.shipping_methods ??
    []) as ShippingMethodShape[];
  const shippingLines = shippingMethods
    .map((sm) =>
      buildShippingLine(
        sm,
        currency,
        options.defaultShippingVatRate,
        shippingUnit
      )
    )
    .filter((line): line is RawLine => line !== null);

  const lines: RawLine[] = [...itemLines, ...shippingLines];
  const expectedHTCents = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPriceCents,
    0
  );

  const reconciled = reconcileInvoiceLineTotals(lines, expectedHTCents);

  const invoice_lines: PennylaneInvoiceLinePayload[] = reconciled.map(
    (line) => ({
      label: line.label,
      quantity: line.quantity,
      raw_currency_unit_price: centsToPennylaneDecimal(
        line.unitPriceCents,
        currency
      ),
      unit: line.unit,
      vat_rate: line.vat_rate,
    })
  );

  const date = formatOrderDate(order.created_at);
  const warnings: string[] = [];
  const transactionReference = resolveTransactionReference({
    order,
    payment,
    pspMapper,
    onUnknownPsp: options.onUnknownPsp,
    warnings,
  });

  const payload: PennylaneInvoiceCreatePayload = {
    date,
    deadline: date,
    customer_id: customerId,
    external_reference: String(order.display_id),
    currency,
    draft: false,
    invoice_lines,
    ...(transactionReference
      ? { transaction_reference: transactionReference }
      : {}),
  };

  return { payload, warnings };
}

/* ------------------------------------------------------------------------ */
/* Internal helpers                                                         */
/* ------------------------------------------------------------------------ */

interface RawLine extends ReconcilableInvoiceLine {
  label: string;
  unit: string;
  vat_rate: string;
}

// Structural types for the fields this module actually reads, so the rest of
// OrderDTO's large surface does not leak into our code.
interface OrderItemShape {
  id: string;
  title?: string | null;
  product_title?: string | null;
  quantity: number;
  total: unknown;
  tax_total: unknown;
  metadata?: Record<string, unknown> | null;
}

interface ShippingMethodShape {
  id: string;
  name?: string | null;
  total: unknown;
  tax_total: unknown;
}

function buildItemLine(
  rawItem: OrderItemShape,
  currency: string,
  options: BuildInvoicePayloadOptions,
  orderId: string,
  itemUnit: string
): RawLine {
  if (rawItem.quantity <= 0) {
    throw new Error(
      `buildInvoicePayload: order ${orderId}, item ${rawItem.id} has quantity ${rawItem.quantity} (expected > 0)`
    );
  }

  const label = coalesceLabel(rawItem);
  const vat_rate = extractVatRate(rawItem, options, orderId);

  const htLineMajor =
    unwrapBigNumber(rawItem.total as never) -
    unwrapBigNumber(rawItem.tax_total as never);
  const htUnitCents = toMinorUnits(htLineMajor / rawItem.quantity, currency);

  return {
    label,
    quantity: rawItem.quantity,
    unitPriceCents: htUnitCents,
    unit: itemUnit,
    vat_rate,
  };
}

function buildShippingLine(
  sm: ShippingMethodShape,
  currency: string,
  defaultVatRate: string,
  shippingUnit: string
): RawLine | null {
  const htMajor =
    unwrapBigNumber(sm.total as never) - unwrapBigNumber(sm.tax_total as never);
  const htCents = toMinorUnits(htMajor, currency);
  if (htCents === 0) return null;

  return {
    label: sm.name && sm.name.length > 0 ? sm.name : DEFAULT_SHIPPING_LABEL,
    quantity: 1,
    unitPriceCents: htCents,
    unit: shippingUnit,
    vat_rate: defaultVatRate,
  };
}

function coalesceLabel(rawItem: OrderItemShape): string {
  if (rawItem.title && rawItem.title.length > 0) return rawItem.title;
  if (rawItem.product_title && rawItem.product_title.length > 0) {
    return rawItem.product_title;
  }
  return `Item ${rawItem.id}`;
}

function extractVatRate(
  rawItem: OrderItemShape,
  options: BuildInvoicePayloadOptions,
  orderId: string
): string {
  const meta = rawItem.metadata;
  if (!meta) {
    throw new Error(
      `buildInvoicePayload: order ${orderId}, item ${rawItem.id} ("${coalesceLabel(rawItem)}") has no metadata — expected ${options.vatMetadataKey}`
    );
  }
  const raw = meta[options.vatMetadataKey];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(
      `buildInvoicePayload: order ${orderId}, item ${rawItem.id} ("${coalesceLabel(rawItem)}") has invalid vat_rate at metadata.${options.vatMetadataKey}: expected non-empty string, got ${typeof raw === "string" ? '""' : JSON.stringify(raw)}`
    );
  }
  return raw;
}

function formatOrderDate(createdAt: string | Date | undefined): string {
  if (!createdAt) return new Date().toISOString().slice(0, 10);
  if (typeof createdAt === "string") return createdAt.slice(0, 10);
  return createdAt.toISOString().slice(0, 10);
}

function resolveTransactionReference(params: {
  order: OrderDTO;
  payment: PaymentDTO | null;
  pspMapper: PspMapper | null;
  onUnknownPsp: OnUnknownPsp;
  warnings: string[];
}): TransactionReference | null {
  const { order, payment, pspMapper, onUnknownPsp, warnings } = params;

  const ref =
    payment && pspMapper ? pspMapper.toTransactionReference(payment) : null;
  if (ref) return ref;

  const providerId = payment?.provider_id ?? "none";
  if (onUnknownPsp === "error") {
    throw new Error(
      `buildInvoicePayload: order ${order.id} has unknown PSP "${providerId}" and onUnknownPsp is "error"; no transaction_reference can be produced`
    );
  }
  if (onUnknownPsp === "warn") {
    warnings.push(
      `no PSP mapper matched provider "${providerId}"; invoice for order ${order.id} emitted without transaction_reference`
    );
  }
  return null;
}
