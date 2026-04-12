/**
 * Pennylane VAT rate codes accepted on invoice lines and products.
 *
 * Source of truth: the OpenAPI spec at
 * https://pennylane.readme.io/openapi/accounting.json
 * (snapshot captured in `__fixtures__/openapi-vat-rates.json`).
 *
 * Scope: French rates + cross-border / special statuses. The upstream
 * spec also accepts 100+ country-specific codes (AT_*, DE_*, ES_*, …);
 * those are intentionally NOT in the narrow type so v1 targets FR
 * e-commerce. A caller targeting another country can still pass any
 * string via product metadata — they just lose type-level autocomplete.
 *
 * Drift is caught by the test in `__tests__/vat-rate.unit.spec.ts`
 * which compares this enum against `__fixtures__/openapi-vat-rates.json`.
 */
export const PENNYLANE_VAT_RATES = [
  // French rates
  "FR_1_05",
  "FR_1_75",
  "FR_09",
  "FR_21",
  "FR_40",
  "FR_50",
  "FR_55",
  "FR_60",
  "FR_65",
  "FR_85",
  "FR_92",
  "FR_100",
  "FR_130",
  "FR_15_385",
  "FR_160",
  "FR_196",
  "FR_200",
  "FR_85_construction",
  "FR_100_construction",
  "FR_200_construction",
  // Special statuses
  "exempt",
  "extracom",
  "intracom_21",
  "intracom_55",
  "intracom_85",
  "intracom_100",
  "crossborder",
  "mixed",
] as const;

export type PennylaneVatRate = (typeof PENNYLANE_VAT_RATES)[number];
