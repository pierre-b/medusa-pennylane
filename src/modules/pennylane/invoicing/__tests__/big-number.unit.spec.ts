import type { BigNumberValue } from "@medusajs/framework/types";

import { unwrapBigNumber } from "../big-number";

describe("unwrapBigNumber", () => {
  it("returns a finite number unchanged", () => {
    expect(unwrapBigNumber(42)).toBe(42);
    expect(unwrapBigNumber(0)).toBe(0);
    expect(unwrapBigNumber(-3.14)).toBe(-3.14);
  });

  it("parses numeric strings", () => {
    expect(unwrapBigNumber("12.5")).toBe(12.5);
    expect(unwrapBigNumber("0")).toBe(0);
    expect(unwrapBigNumber("-7")).toBe(-7);
  });

  it("unwraps an IBigNumber-shaped object via .numeric", () => {
    const v = { numeric: 12.5 } as unknown as BigNumberValue;
    expect(unwrapBigNumber(v)).toBe(12.5);
  });

  it("unwraps a BigNumber-like object via .toNumber()", () => {
    const v = { toNumber: () => 3 } as unknown as BigNumberValue;
    expect(unwrapBigNumber(v)).toBe(3);
  });

  it("throws on un-parseable strings", () => {
    expect(() =>
      unwrapBigNumber("not a number" as unknown as BigNumberValue)
    ).toThrow(/parse/i);
  });

  it("throws on NaN / Infinity / unknown shapes", () => {
    expect(() => unwrapBigNumber(NaN as unknown as BigNumberValue)).toThrow(
      /finite/i
    );
    expect(() =>
      unwrapBigNumber(Infinity as unknown as BigNumberValue)
    ).toThrow(/finite/i);
    expect(() =>
      unwrapBigNumber({ weird: 42 } as unknown as BigNumberValue)
    ).toThrow(/unwrap/i);
    expect(() => unwrapBigNumber(null as unknown as BigNumberValue)).toThrow(
      /unwrap/i
    );
  });
});
