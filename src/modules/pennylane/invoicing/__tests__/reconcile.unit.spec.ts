import { reconcileInvoiceLineTotals } from "../reconcile";

describe("reconcileInvoiceLineTotals — happy path", () => {
  it("returns the input unchanged when no drift exists", () => {
    const lines = [
      { quantity: 2, unitPriceCents: 850 },
      { quantity: 1, unitPriceCents: 2417 },
      { quantity: 1, unitPriceCents: 492 },
    ];
    const result = reconcileInvoiceLineTotals(lines, 850 * 2 + 2417 + 492);
    expect(result).toBe(lines);
  });

  it("adjusts the largest quantity-1 line by +1 cent when drift is +1", () => {
    const lines = [
      { quantity: 1, unitPriceCents: 500 },
      { quantity: 1, unitPriceCents: 2417 }, // largest
      { quantity: 1, unitPriceCents: 492 },
    ];
    const expected = 500 + 2417 + 492 + 1;
    const result = reconcileInvoiceLineTotals(lines, expected);
    expect(result).toEqual([
      { quantity: 1, unitPriceCents: 500 },
      { quantity: 1, unitPriceCents: 2418 },
      { quantity: 1, unitPriceCents: 492 },
    ]);
  });

  it("adjusts the largest line by -1 cent when drift is -1", () => {
    const lines = [
      { quantity: 1, unitPriceCents: 500 },
      { quantity: 1, unitPriceCents: 2417 },
      { quantity: 1, unitPriceCents: 492 },
    ];
    const expected = 500 + 2417 + 492 - 1;
    const result = reconcileInvoiceLineTotals(lines, expected);
    expect(result[1].unitPriceCents).toBe(2416);
  });

  it("distributes drift fractionally when the largest line has quantity > 1", () => {
    const lines = [
      { quantity: 3, unitPriceCents: 1000 }, // largest total 3000
      { quantity: 1, unitPriceCents: 500 },
    ];
    const expected = 3000 + 500 + 1; // +1 cent drift
    const result = reconcileInvoiceLineTotals(lines, expected);
    expect(result[0].unitPriceCents).toBeCloseTo(1000 + 1 / 3, 10);
    expect(result[1].unitPriceCents).toBe(500);
  });

  it("picks the first line when multiple lines tie on largest total", () => {
    const lines = [
      { quantity: 1, unitPriceCents: 1000 },
      { quantity: 1, unitPriceCents: 1000 }, // same total — first wins? no, first occurrence is index 0
      { quantity: 1, unitPriceCents: 500 },
    ];
    const result = reconcileInvoiceLineTotals(lines, 1000 + 1000 + 500 + 1);
    expect(result[0].unitPriceCents).toBe(1001);
    expect(result[1].unitPriceCents).toBe(1000);
    expect(result[2].unitPriceCents).toBe(500);
  });
});

describe("reconcileInvoiceLineTotals — validation + edge cases", () => {
  it("throws when drift exceeds +1 cent", () => {
    const lines = [{ quantity: 1, unitPriceCents: 1000 }];
    expect(() => reconcileInvoiceLineTotals(lines, 1002)).toThrow(/drift.*2/i);
  });

  it("throws when drift exceeds -1 cent (e.g., -5)", () => {
    const lines = [{ quantity: 1, unitPriceCents: 1000 }];
    expect(() => reconcileInvoiceLineTotals(lines, 995)).toThrow(/drift.*-?5/i);
  });

  it("returns [] for empty lines when expectedTotalCents is 0", () => {
    const result = reconcileInvoiceLineTotals([], 0);
    expect(result).toEqual([]);
  });

  it("throws for empty lines when expectedTotalCents is non-zero", () => {
    expect(() => reconcileInvoiceLineTotals([], 100)).toThrow(/empty/i);
  });

  it("throws for a non-finite expectedTotalCents", () => {
    expect(() =>
      reconcileInvoiceLineTotals([{ quantity: 1, unitPriceCents: 10 }], NaN)
    ).toThrow(/finite/i);
    expect(() =>
      reconcileInvoiceLineTotals(
        [{ quantity: 1, unitPriceCents: 10 }],
        Infinity
      )
    ).toThrow(/finite/i);
  });

  it("does not mutate the caller's array or its elements", () => {
    const original = [
      { quantity: 1, unitPriceCents: 1000 },
      { quantity: 1, unitPriceCents: 2000 },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    const elementRefs = [...original];

    reconcileInvoiceLineTotals(original, 1000 + 2000 + 1);

    expect(original).toEqual(snapshot);
    expect(original[0]).toBe(elementRefs[0]);
    expect(original[1]).toBe(elementRefs[1]);
  });
});

describe("reconcileInvoiceLineTotals — pass-through field preservation", () => {
  it("preserves arbitrary fields on un-adjusted lines", () => {
    const lines = [
      { quantity: 1, unitPriceCents: 500, label: "Small", vat_rate: "FR_55" },
      { quantity: 1, unitPriceCents: 2000, label: "Big", vat_rate: "FR_200" },
    ];
    const result = reconcileInvoiceLineTotals(lines, 500 + 2000 + 1);
    expect(result[0]).toEqual({
      quantity: 1,
      unitPriceCents: 500,
      label: "Small",
      vat_rate: "FR_55",
    });
  });

  it("preserves arbitrary fields on the adjusted line (only unitPriceCents changes)", () => {
    const lines = [
      { quantity: 1, unitPriceCents: 500, label: "Small", vat_rate: "FR_55" },
      {
        quantity: 1,
        unitPriceCents: 2000,
        label: "Big",
        vat_rate: "FR_200",
        notes: "adjusted?",
      },
    ];
    const result = reconcileInvoiceLineTotals(lines, 500 + 2000 + 1);
    expect(result[1]).toEqual({
      quantity: 1,
      unitPriceCents: 2001,
      label: "Big",
      vat_rate: "FR_200",
      notes: "adjusted?",
    });
  });
});
