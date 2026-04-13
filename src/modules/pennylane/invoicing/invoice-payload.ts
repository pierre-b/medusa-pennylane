import type {
  OrderDTO,
  OrderLineItemDTO,
  OrderShippingMethodDTO,
  PaymentDTO,
} from "@medusajs/framework/types";

import type { PspMapper, TransactionReference } from "../psp/mapper";
import type { OnUnknownPsp } from "../psp/registry";

import { centsToPennylaneDecimal, toMinorUnits } from "./amounts";
import { unwrapBigNumber } from "./big-number";

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
  label: string;
  transaction_reference?: TransactionReference;
  invoice_lines: PennylaneInvoiceLinePayload[];
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

  const items = order.items ?? [];
  if (items.length === 0) {
    throw new Error(`buildInvoicePayload: order ${order.id} has no items`);
  }

  if (order.display_id === undefined || order.display_id === null) {
    throw new Error(
      `buildInvoicePayload: order ${order.id} has no display_id; cannot form external_reference`
    );
  }

  const currency = String(order.currency_code ?? "EUR").toUpperCase();
  const itemUnit = options.itemUnit ?? DEFAULT_ITEM_UNIT;
  const shippingUnit = options.shippingUnit ?? DEFAULT_SHIPPING_UNIT;
  const warnings: string[] = [];

  const itemLines = items.map((rawItem) =>
    buildItemLine({
      rawItem,
      currency,
      options,
      orderId: order.id,
      itemUnit,
      warnings,
    })
  );

  const shippingMethods = order.shipping_methods ?? [];
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

  // No reconciliation here — unitPriceCents is a fractional cent count
  // (htLineCents / quantity). Pennylane formats the HT total as
  // `unit_price × quantity` at up to 6-decimal precision, which exactly
  // reproduces htLineCents for each line. D6 would have no genuinely
  // external truth to reconcile against (expected = derived from the same
  // source as the lines), so we skip it here. D6 remains available for
  // future consumers that have an independent truth (e.g., E-series
  // credit notes reconciled against the refund amount).
  const invoice_lines: PennylaneInvoiceLinePayload[] = lines.map((line) => ({
    label: line.label,
    quantity: line.quantity,
    raw_currency_unit_price: centsToPennylaneDecimal(
      line.unitPriceCents,
      currency
    ),
    unit: line.unit,
    vat_rate: line.vat_rate,
  }));

  const date = formatOrderDate(order.created_at);
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
    label: `Medusa order #${order.display_id}`,
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

interface RawLine {
  label: string;
  quantity: number;
  /**
   * HT unit price expressed in minor currency units.
   *
   * Integer for clean divisions (quantity 1, or quantity N where the line
   * total in cents is divisible by N). Fractional when the division produces
   * a remainder — `centsToPennylaneDecimal` then formats with 6 decimals,
   * Pennylane's `raw_currency_unit_price` cap, so `unit_price × quantity`
   * reproduces the exact line HT on Pennylane's side.
   */
  unitPriceCents: number;
  unit: string;
  vat_rate: string;
}

function buildItemLine(params: {
  rawItem: OrderLineItemDTO;
  currency: string;
  options: BuildInvoicePayloadOptions;
  orderId: string;
  itemUnit: string;
  warnings: string[];
}): RawLine {
  const { rawItem, currency, options, orderId, itemUnit, warnings } = params;

  if (rawItem.quantity <= 0) {
    throw new Error(
      `buildInvoicePayload: order ${orderId}, item ${rawItem.id} has quantity ${rawItem.quantity} (expected > 0)`
    );
  }

  const label = coalesceLabel(rawItem);
  const vat_rate = extractVatRate(rawItem, options, orderId);

  const htLineMajor =
    unwrapBigNumber(rawItem.total) - unwrapBigNumber(rawItem.tax_total);
  const htLineCents = toMinorUnits(htLineMajor, currency);
  const htUnitCents = htLineCents / rawItem.quantity;

  // Fractional quantity with the default unit="piece" is accounting-weird
  // (invoice line reads "1.5 pieces"). Warn rather than throw — weight-based
  // products are legitimate in some hosts; operators can configure a better
  // `itemUnit` or read the warning and ignore.
  if (!Number.isInteger(rawItem.quantity) && itemUnit === DEFAULT_ITEM_UNIT) {
    warnings.push(
      `order ${orderId}, item ${rawItem.id} ("${label}") has fractional quantity ${rawItem.quantity} with default unit "${DEFAULT_ITEM_UNIT}"; invoice line will read "${rawItem.quantity} ${DEFAULT_ITEM_UNIT}". Configure a non-default itemUnit if weight-based.`
    );
  }

  return {
    label,
    quantity: rawItem.quantity,
    unitPriceCents: htUnitCents,
    unit: itemUnit,
    vat_rate,
  };
}

function buildShippingLine(
  sm: OrderShippingMethodDTO,
  currency: string,
  defaultVatRate: string,
  shippingUnit: string
): RawLine | null {
  const htMajor = unwrapBigNumber(sm.total) - unwrapBigNumber(sm.tax_total);
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

function coalesceLabel(rawItem: OrderLineItemDTO): string {
  if (rawItem.title && rawItem.title.length > 0) return rawItem.title;
  if (rawItem.product_title && rawItem.product_title.length > 0) {
    return rawItem.product_title;
  }
  return `Item ${rawItem.id}`;
}

function extractVatRate(
  rawItem: OrderLineItemDTO,
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

  if (payment && pspMapper) {
    const ref = pspMapper.toTransactionReference(payment);
    if (ref) {
      assertValidTransactionReference(ref, pspMapper.id, order.id);
      return ref;
    }
  }

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

/**
 * Guards against malformed TransactionReference objects coming from
 * user-supplied custom mappers. The registry validates the *methods* of a
 * custom mapper at construction, but not what they return at runtime; a
 * malformed ref would otherwise go straight to Pennylane and surface as a
 * 422 with an opaque message far from the root cause.
 */
function assertValidTransactionReference(
  ref: TransactionReference,
  mapperId: string,
  orderId: string
): void {
  const fields: (keyof TransactionReference)[] = [
    "banking_provider",
    "provider_field_name",
    "provider_field_value",
  ];
  for (const field of fields) {
    const value = ref[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `buildInvoicePayload: mapper "${mapperId}" returned an invalid transaction_reference for order ${orderId} — field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`
      );
    }
  }
}
