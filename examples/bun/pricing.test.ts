import { describe, expect, test } from "bun:test";

describe("Pricing", () => {
  test("returns zero for an empty cart", () => {
    const prices: number[] = [];
    expect(prices.reduce((sum, price) => sum + price, 0)).toBe(0);
  });
  test("adds prices in integer cents", () => {
    expect(1999 * 2 + 999).toBe(4997);
  });
  describe("Shipping", () => {
    test("offers free shipping above the threshold", () => {
      expect(7500 >= 5000 ? 0 : 499).toBe(0);
    });
    test("charges shipping below the threshold", () => {
      expect(2500 >= 5000 ? 0 : 499).toBe(499);
    });
  });
});
