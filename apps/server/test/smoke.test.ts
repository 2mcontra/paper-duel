import { expect, it } from "vitest";
import { SLOT_NUMBERS } from "@paper-duel/engine";

it("resolves the engine workspace package", () => {
  expect(SLOT_NUMBERS).toEqual([1, 3, 5, 7, 9]);
});
