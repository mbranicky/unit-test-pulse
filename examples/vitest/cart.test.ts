import { describe, expect, test } from "vitest";
describe("Shopping cart", () => {
  test("adds item quantities", () => {
    console.log("Adding 2 books and 1 notebook");
    expect(2 + 1).toBe(3);
  });
  test("applies the welcome discount", () => {
    console.error("Checkout diagnostic: expected a 10% discount");
    expect({ total: 59.97 }).toEqual({ total: 53.97 });
  });
  let attempt = 0;
  test("retries a temporary inventory lookup", () => {
    expect(++attempt).toBe(2);
  });
  test.skip("supports gift wrapping", () => {});
  test.todo("supports discount stacking");
  test("waits for the inventory service", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(true).toBe(true);
  });
});
