export interface ReconcilableInvoiceLine {
  quantity: number;
  unitPriceCents: number;
}

const MAX_DRIFT_CENTS = 1;

/**
 * Ensures `sum(line.quantity * line.unitPriceCents) === expectedTotalCents`.
 * Adjusts the largest line (by `quantity * unitPriceCents`) by `drift / quantity`
 * when drift ∈ {-1, +1}; fractional cents are preserved since Pennylane's
 * `raw_currency_unit_price` accepts up to 6 decimals.
 *
 * Ties on largest total resolve to the first-encountered line (deterministic).
 *
 * Throws when:
 *   - |drift| > 1
 *   - `expectedTotalCents` is not finite
 *   - lines is empty AND `expectedTotalCents` is non-zero
 *
 * Pure function — never mutates the input array or its element objects.
 * Generic in `T` so caller types (label, vat_rate, …) survive unchanged.
 */
export function reconcileInvoiceLineTotals<T extends ReconcilableInvoiceLine>(
  lines: readonly T[],
  expectedTotalCents: number
): T[] {
  if (!Number.isFinite(expectedTotalCents)) {
    throw new Error(
      `reconcileInvoiceLineTotals: expectedTotalCents must be a finite number (received ${expectedTotalCents})`
    );
  }

  if (lines.length === 0) {
    if (expectedTotalCents !== 0) {
      throw new Error(
        `reconcileInvoiceLineTotals: cannot reconcile empty lines against a non-zero expected total (${expectedTotalCents})`
      );
    }
    return [];
  }

  const currentSum = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPriceCents,
    0
  );
  const drift = expectedTotalCents - currentSum;

  if (drift === 0) {
    return lines as T[];
  }

  if (Math.abs(drift) > MAX_DRIFT_CENTS) {
    throw new Error(
      `reconcileInvoiceLineTotals: drift of ${drift} cents exceeds the ${MAX_DRIFT_CENTS}-cent limit; lines sum to ${currentSum}, expected ${expectedTotalCents}`
    );
  }

  const largestIndex = indexOfLargestLine(lines);
  const target = lines[largestIndex];
  const adjusted: T = {
    ...target,
    unitPriceCents: target.unitPriceCents + drift / target.quantity,
  };

  const result = [...lines];
  result[largestIndex] = adjusted;
  return result;
}

function indexOfLargestLine(lines: readonly ReconcilableInvoiceLine[]): number {
  let bestIndex = 0;
  let bestTotal = lines[0].quantity * lines[0].unitPriceCents;
  for (let i = 1; i < lines.length; i++) {
    const total = lines[i].quantity * lines[i].unitPriceCents;
    if (total > bestTotal) {
      bestTotal = total;
      bestIndex = i;
    }
  }
  return bestIndex;
}
