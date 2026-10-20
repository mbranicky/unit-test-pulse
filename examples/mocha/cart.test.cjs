const assert = require("node:assert/strict");

describe("Shopping cart", () => {
  it("adds item quantities", () => {
    console.log("Adding 2 books and 1 notebook");
    assert.equal(2 + 1, 3);
  });
  it("applies the welcome discount", () => {
    console.error("Checkout diagnostic: expected a 10% discount");
    assert.deepEqual({ total: 59.97 }, { total: 53.97 });
  });
  let attempt = 0;
  it("retries a temporary inventory lookup", function () {
    this.retries(1);
    console.log(`Inventory lookup attempt ${attempt + 1}`);
    assert.equal(++attempt, 2);
  });
  it.skip("supports gift wrapping", () => {});
  // Mocha reports a declaration without a callback as pending, not todo.
  it("supports discount stacking");
  it("waits for the inventory service", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.ok(true);
  });
});
