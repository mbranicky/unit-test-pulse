describe("Shopping cart", () => {
  it("adds item quantities", () => {
    console.log("Adding 2 books and 1 notebook");
    expect(2 + 1).toBe(3);
  });
  it("applies the welcome discount", () => {
    console.error("Checkout diagnostic: expected a 10% discount");
    // Jasmine supplies an owning spec identity for this failed-spec debug log.
    jasmine.debugLog("The welcome discount should reduce the total by 10%");
    expect({ total: 59.97 }).toEqual({ total: 53.97 });
  });
  it("looks up available inventory", () => {
    expect({ available: 12 }).toEqual({ available: 12 });
  });
  xit("supports gift wrapping", () => {});
  // Jasmine has no todo status; pending results appear as skipped in the panel.
  it("supports discount stacking", () =>
    pending("Promotion rules are not implemented"));
  it("waits for the inventory service", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(true).toBeTrue();
  });
});
