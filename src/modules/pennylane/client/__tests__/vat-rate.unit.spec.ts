import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PENNYLANE_VAT_RATES } from "../vat-rate";

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "..", "__fixtures__", "openapi-vat-rates.json"),
    "utf8"
  )
) as { fr_rates: string[]; specials: string[] };

const specCodes = [...fixture.fr_rates, ...fixture.specials];

describe("PENNYLANE_VAT_RATES vs OpenAPI fixture", () => {
  it("includes every spec code in the fixture (no regression)", () => {
    for (const code of specCodes) {
      expect(PENNYLANE_VAT_RATES).toContain(code);
    }
  });

  it("does not include any code not present in the fixture (no drift)", () => {
    for (const code of PENNYLANE_VAT_RATES) {
      expect(specCodes).toContain(code);
    }
  });

  it("uses the spec-correct reduced French rate (FR_55, not FR_055)", () => {
    expect(PENNYLANE_VAT_RATES).toContain("FR_55");
    expect(PENNYLANE_VAT_RATES).not.toContain("FR_055");
  });
});
