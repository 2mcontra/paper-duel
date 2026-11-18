import { describe, expect, it } from "vitest";
import { slotForPage } from "../src/index.js";

describe("slotForPage", () => {
  it("maps odd last digits to slots", () => {
    expect(slotForPage(137)).toBe(7);
    expect(slotForPage(1)).toBe(1);
  });
  it("returns null for even last digits", () => {
    expect(slotForPage(120)).toBeNull();
    expect(slotForPage(44)).toBeNull();
  });
});
