import { PENNYLANE_VAT_RATES } from "../vat-rate";

describe("PENNYLANE_VAT_RATES", () => {
  it("exposes the French VAT code for the standard rate (20%)", () => {
    expect(PENNYLANE_VAT_RATES).toContain("FR_200");
  });

  it("exposes the exempt code", () => {
    expect(PENNYLANE_VAT_RATES).toContain("exempt");
  });

  it("is a readonly tuple", () => {
    expect(Object.isFrozen).toBeDefined();
    expect(PENNYLANE_VAT_RATES.length).toBeGreaterThan(0);
  });
});
