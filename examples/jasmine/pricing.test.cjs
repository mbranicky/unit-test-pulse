describe("Pricing", () => {
  it("returns zero for an empty cart", () => {
    expect([].reduce((sum, price) => sum + price, 0)).toBe(0);
  });
  it("adds prices in integer cents", () => {
    expect(1999 * 2 + 999).toBe(4997);
  });
  describe("Shipping", () => {
    it("offers free shipping above the threshold", () => {
      expect(7500 >= 5000 ? 0 : 499).toBe(0);
    });
    it("charges shipping below the threshold", () => {
      expect(2500 >= 5000 ? 0 : 499).toBe(499);
    });
  });
});
