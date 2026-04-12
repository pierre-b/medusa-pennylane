/**
 * Pennylane VAT rate codes accepted on invoice lines and products.
 *
 * Source of truth: the OpenAPI spec at
 * https://pennylane.readme.io/openapi/accounting.json
 * (snapshot captured in `__fixtures__/openapi-vat-rates.json`).
 *
 * Encoding pattern: `FR_<N>` where `<N>` is the percentage times 10.
 * Fractional rates use an underscore to separate the integer and
 * fractional parts. For example:
 *
 *   FR_21       → 2.1%   (super-réduit mainland, presse / médicaments)
 *   FR_55       → 5.5%   (réduit, alimentation / livres / transports)
 *   FR_100      → 10.0%  (intermédiaire, restauration / travaux rénovation)
 *   FR_196      → 19.6%  (ancien taux normal, pré-2014)
 *   FR_200      → 20.0%  (taux normal)
 *   FR_1_05     → 1.05%  (super-super-réduit DOM, presse)
 *   FR_1_75     → 1.75%  (DOM, produits spécifiques)
 *   FR_15_385   → 15.385% (historique / transition)
 *   FR_85       → 8.5%   (intermédiaire DOM)
 *   FR_09       → 0.9%   (Corsica, presse)
 *
 * Codes suffixed `_construction` apply specifically to construction
 * work (travaux) at the same numeric rate — e.g., `FR_100_construction`
 * is 10% on travaux de rénovation.
 *
 * Special statuses (not French-rate codes):
 *   exempt        → 0% / exonéré
 *   extracom      → extra-EU sale (export)
 *   intracom_*    → intra-EU B2B sale at the given rate
 *   crossborder   → reverse-charge cross-border
 *   mixed         → composite lines with multiple rates
 *
 * Always confirm the applicable code with your expert-comptable — the
 * upstream spec is the API contract, not the French tax authority.
 *
 * Scope: this enum ships only French + cross-border / special codes.
 * The upstream spec also accepts 100+ country-specific codes
 * (AT_*, DE_*, ES_*, …); those are intentionally NOT in the narrow
 * type so v1 targets FR e-commerce. A caller targeting another
 * country can still pass any string via product metadata — they just
 * lose type-level autocomplete.
 *
 * Drift is caught by the test in `__tests__/vat-rate.unit.spec.ts`
 * which compares this enum against `__fixtures__/openapi-vat-rates.json`.
 */
export const PENNYLANE_VAT_RATES = [
  // French rates (FR_<N>: N is the % times 10; underscores split fractions)
  "FR_09",
  "FR_1_05",
  "FR_1_75",
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
