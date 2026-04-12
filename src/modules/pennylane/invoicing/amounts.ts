/**
 * ISO 4217 currencies with zero minor units — no decimal places.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

/**
 * ISO 4217 currencies with three minor units (fils, etc.).
 */
const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

const PENNYLANE_MAX_DECIMALS = 6;

/**
 * Returns the number of fraction digits for the given ISO 4217 currency code.
 * Case-insensitive. Unknown codes default to 2 (the overwhelmingly common case).
 */
export function getCurrencyDecimals(currency: string): number {
  const normalized = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return 2;
}

/**
 * Converts an amount expressed in minor currency units into Pennylane's decimal
 * string format. See the module-level docstring in the feature doc for the full
 * contract.
 */
export function centsToPennylaneDecimal(
  amount: number,
  currency: string = "EUR"
): string {
  if (!Number.isFinite(amount)) {
    throw new Error(
      `centsToPennylaneDecimal: amount must be a finite number (received ${amount})`
    );
  }
  const decimals = getCurrencyDecimals(currency);
  const divisor = 10 ** decimals;
  const value = amount / divisor;

  if (Number.isInteger(amount)) {
    return value.toFixed(decimals);
  }

  // Fractional input (D6 largest-line adjustment on quantity > 1) — preserve
  // precision up to Pennylane's 6-decimal cap on `raw_currency_unit_price`.
  // Zero-decimal currencies (JPY, etc.) have no minor unit, so fractional
  // inputs are rounded back to the integer major unit rather than emitted as
  // nonsensical "1250.500000".
  if (decimals === 0) {
    return value.toFixed(0);
  }
  return value.toFixed(PENNYLANE_MAX_DECIMALS);
}
