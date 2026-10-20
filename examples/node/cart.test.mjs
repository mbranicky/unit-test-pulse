import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Shopping cart", () => {
  it("adds item quantities", () => {
    console.log("Adding 2 books and 1 notebook");
    assert.equal(2 + 1, 3);
  });
  it("applies the welcome discount", () => {
    console.error("Checkout diagnostic: expected a 10% discount");
    assert.deepEqual({ total: 59.97 }, { total: 53.97 });
  });
  it("looks up available inventory", () => {
    assert.deepEqual({ available: 12 }, { available: 12 });
  });
  it.skip("supports gift wrapping", () => {});
  it.todo("supports discount stacking");
  it("waits for the inventory service", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.ok(true);
  });
});
