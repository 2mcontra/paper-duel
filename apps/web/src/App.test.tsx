import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StickFigure } from "./components/StickFigure.js";
import { describeEvent } from "./text.js";
import { BookPage } from "./components/Book.js";

const ctx = { you: 0 as const, names: ["Ann", "Ben"] as [string, string] };

describe("describeEvent", () => {
  it("speaks to you and names the opponent", () => {
    expect(
      describeEvent({ type: "PartDrawn", player: 0, slot: 5, part: "gun", stage: 4 }, ctx),
    ).toBe("You drew a gun on slot 5.");
    expect(describeEvent({ type: "SlotEliminated", attacker: 1, slot: 3 }, ctx)).toBe(
      "BANG! Ben eliminated your slot 3.",
    );
    expect(describeEvent({ type: "GameOver", winner: 0, reason: "fights_won" }, ctx)).toBe(
      "You win!",
    );
    expect(describeEvent({ type: "TurnPassed", to: 1 }, ctx)).toBeNull();
  });
});

describe("StickFigure", () => {
  it("adds parts by stage", () => {
    const count = (stage: 0 | 1 | 2 | 3 | 4 | 5) =>
      (
        renderToString(<StickFigure stage={stage} eliminated={false} label="x" />).match(
          /<(circle|path)/g,
        ) ?? []
      ).length;
    const counts = ([1, 2, 3, 4, 5] as const).map(count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(5);
  });

  it("marks eliminated figures with an X", () => {
    expect(renderToString(<StickFigure stage={4} eliminated label="x" />)).toContain("figure__x");
  });
});

describe("BookPage", () => {
  it("highlights the last digit and explains it", () => {
    const html = renderToString(<BookPage roll={{ page: 137, digit: 7, player: 0 }} youRolled />);
    expect(html).toContain("13<mark");
    expect(html).toContain("slot 7");
    const even = renderToString(
      <BookPage roll={{ page: 42, digit: 2, player: 1 }} youRolled={false} />,
    );
    expect(even).toContain("even, no game");
  });
});
