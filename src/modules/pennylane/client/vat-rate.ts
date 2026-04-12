/**
 * Pennylane VAT rate codes used on invoice lines.
 *
 * Placeholder values — the authoritative enum is assembled during feature
 * task A4 after verifying the exact codes against the Pennylane OpenAPI
 * spec at https://pennylane.readme.io/openapi/accounting.json. In particular,
 * `FR_055` vs `FR_55` for the 5.5% reduced rate must be confirmed before
 * any Pennylane invoice line is built from this enum.
 */
export const PENNYLANE_VAT_RATES = [
  "FR_055",
  "FR_100",
  "FR_200",
  "FR_21",
  "exempt",
] as const;

export type PennylaneVatRate = (typeof PENNYLANE_VAT_RATES)[number];
