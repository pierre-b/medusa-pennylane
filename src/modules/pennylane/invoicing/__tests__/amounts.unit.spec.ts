import { centsToPennylaneDecimal, getCurrencyDecimals } from "../amounts";

describe("centsToPennylaneDecimal", () => {
  it("formats EUR by default", () => {
    expect(centsToPennylaneDecimal(1250)).toBe("12.50");
  });

  it("formats an explicit EUR amount", () => {
    expect(centsToPennylaneDecimal(1250, "EUR")).toBe("12.50");
  });

  it("formats USD with 2 decimals", () => {
    expect(centsToPennylaneDecimal(1250, "USD")).toBe("12.50");
  });

  it("formats GBP with 2 decimals", () => {
    expect(centsToPennylaneDecimal(1250, "GBP")).toBe("12.50");
  });

  it("formats JPY with 0 decimals (no minor unit)", () => {
    expect(centsToPennylaneDecimal(1250, "JPY")).toBe("1250");
  });

  it("formats KWD with 3 decimals", () => {
    expect(centsToPennylaneDecimal(1000, "KWD")).toBe("1.000");
  });

  it("formats zero", () => {
    expect(centsToPennylaneDecimal(0, "EUR")).toBe("0.00");
  });

  it("formats the smallest EUR unit", () => {
    expect(centsToPennylaneDecimal(1, "EUR")).toBe("0.01");
  });

  it("formats negative amounts (credit notes)", () => {
    expect(centsToPennylaneDecimal(-500, "EUR")).toBe("-5.00");
  });

  it("falls back to 2 decimals for unknown currencies", () => {
    expect(centsToPennylaneDecimal(1250, "XYZ")).toBe("12.50");
  });

  it("accepts case-insensitive currency codes", () => {
    expect(centsToPennylaneDecimal(1250, "eur")).toBe("12.50");
    expect(centsToPennylaneDecimal(1250, "jpy")).toBe("1250");
  });

  it("uses 6 decimals for fractional cents (D6-adjusted lines)", () => {
    expect(centsToPennylaneDecimal(1250.333, "EUR")).toBe("12.503330");
  });

  it("throws on NaN", () => {
    expect(() => centsToPennylaneDecimal(NaN, "EUR")).toThrow(/finite/i);
  });

  it("throws on Infinity", () => {
    expect(() => centsToPennylaneDecimal(Infinity, "EUR")).toThrow(/finite/i);
    expect(() => centsToPennylaneDecimal(-Infinity, "EUR")).toThrow(/finite/i);
  });
});

describe("getCurrencyDecimals", () => {
  it("returns 2 for EUR", () => {
    expect(getCurrencyDecimals("EUR")).toBe(2);
  });

  it("returns 0 for JPY (zero-decimal currency)", () => {
    expect(getCurrencyDecimals("JPY")).toBe(0);
  });

  it("returns 3 for KWD (three-decimal currency)", () => {
    expect(getCurrencyDecimals("KWD")).toBe(3);
  });
});
