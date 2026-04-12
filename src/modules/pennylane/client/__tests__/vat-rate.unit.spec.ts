import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PENNYLANE_VAT_RATES } from "../vat-rate";

const rawFixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "..", "__fixtures__", "openapi-vat-rates.json"),
    "utf8"
  )
) as Record<string, unknown>;

const assertStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(
      `openapi-vat-rates.json fixture is corrupt: '${field}' is not an array`
    );
  }
  if (value.length === 0) {
    throw new Error(
      `openapi-vat-rates.json fixture is corrupt: '${field}' is empty`
    );
  }
  if (!value.every((v) => typeof v === "string")) {
    throw new Error(
      `openapi-vat-rates.json fixture is corrupt: '${field}' contains non-string values`
    );
  }
  return value;
};

const frRates = assertStringArray(rawFixture.fr_rates, "fr_rates");
const specials = assertStringArray(rawFixture.specials, "specials");
const specCodes = [...frRates, ...specials];

describe("PENNYLANE_VAT_RATES vs OpenAPI fixture", () => {
  it("includes every spec code in the fixture (no regression)", () => {
    expect([...PENNYLANE_VAT_RATES]).toEqual(expect.arrayContaining(specCodes));
  });

  it("does not include any code absent from the fixture (no drift)", () => {
    expect(specCodes).toEqual(expect.arrayContaining([...PENNYLANE_VAT_RATES]));
  });

  it("uses the spec-correct reduced French rate (FR_55, not FR_055)", () => {
    expect(PENNYLANE_VAT_RATES).toContain("FR_55");
    expect(PENNYLANE_VAT_RATES).not.toContain("FR_055");
  });
});
