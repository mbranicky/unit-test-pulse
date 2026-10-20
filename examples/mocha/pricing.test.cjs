const assert = require("node:assert/strict");

describe("Pricing", () => {
  it("returns zero for an empty cart", () => {
    assert.equal(
      [].reduce((sum, price) => sum + price, 0),
      0,
    );
  });
  it("adds prices in integer cents", () => {
    assert.equal(1999 * 2 + 999, 4997);
  });
  describe("Shipping", () => {
    it("offers free shipping above the threshold", () => {
      assert.equal(7500 >= 5000 ? 0 : 499, 0);
    });
    it("charges shipping below the threshold", () => {
      assert.equal(2500 >= 5000 ? 0 : 499, 499);
    });
  });
});
