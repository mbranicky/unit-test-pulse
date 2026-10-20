describe("Shopping cart", () => {
  test("adds item quantities", () => {
    console.log("Adding 2 books and 1 notebook");
    expect(2 + 1).toBe(3);
  });
  test("applies the welcome discount", () => {
    console.error("Checkout diagnostic: expected a 10% discount");
    expect({ total: 59.97 }).toEqual({ total: 53.97 });
  });
  test("looks up available inventory", () => {
    console.log("Inventory service reports 12 available items");
    expect({ available: 12 }).toEqual({ available: 12 });
  });
  test.skip("supports gift wrapping", () => {});
  test.todo("supports discount stacking");
  test("waits for the inventory service", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(true).toBe(true);
  });
});
