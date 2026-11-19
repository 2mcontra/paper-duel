import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BookPage } from "./components/Book.js";
import { EventLog } from "./components/EventLog.js";
import { StickFigure } from "./components/StickFigure.js";
import { describeEvent } from "./text.js";

const ctx = { you: 0, names: ["Ann", "Ben", "Cat"] };

describe("describeEvent", () => {
  it("speaks to you and names the others", () => {
    expect(
      describeEvent({ type: "PartDrawn", player: 0, slot: 5, part: "gun", stage: 4 }, ctx),
    ).toBe("You draw a gun on slot 5.");
    expect(
      describeEvent({ type: "PartDrawn", player: 2, slot: 5, part: "bullets", stage: 5 }, ctx),
    ).toBe("Cat draws 3 bullets on slot 5.");
    expect(describeEvent({ type: "ShotFired", attacker: 1, targets: [0, 2], slot: 3 }, ctx)).toBe(
      "Ben fires slot 3 at you and Cat!",
    );
    expect(describeEvent({ type: "SlotEliminated", attacker: 1, target: 0, slot: 3 }, ctx)).toBe(
      "BANG! Your slot 3 is gone.",
    );
    expect(describeEvent({ type: "ShotBlocked", attacker: 0, target: 2, slot: 3 }, ctx)).toBe(
      "🛡️ Cat's shield blocked it.",
    );
    expect(describeEvent({ type: "PlayerOut", player: 1, reason: "shot", by: 0 }, ctx)).toBe(
      "💀 Ben is out!",
    );
    expect(describeEvent({ type: "GameOver", winner: 0, reason: "last_standing" }, ctx)).toBe(
      "🏆 You win!",
    );
    expect(describeEvent({ type: "PlayerReady", player: 1 }, ctx)).toBeNull();
  });

  it("only names the card when it is yours", () => {
    expect(describeEvent({ type: "CardDrawn", player: 0, card: "shield" }, ctx)).toMatch(
      /You get 🛡️ Shield/,
    );
    expect(describeEvent({ type: "CardDrawn", player: 1, card: null }, ctx)).toBe(
      "🍀 Lucky page! Ben gets a card.",
    );
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
    const html = renderToString(<BookPage page={137} caption="Your page" />);
    expect(html).toContain("13<mark");
    expect(html).toContain("slot 7");
    expect(renderToString(<BookPage page={42} caption="x" />)).toContain("even, no game");
    expect(renderToString(<BookPage page={null} caption="x" />)).toContain("closed");
  });
});

describe("EventLog", () => {
  it("groups by round, newest first", () => {
    const raw = renderToString(
      <EventLog
        you={0}
        names={ctx.names}
        log={[
          { type: "RoundStarted", round: 1, order: [0, 1] },
          { type: "BookOpened", player: 0, page: 13, digit: 3 },
          { type: "PartDrawn", player: 0, slot: 3, part: "head", stage: 1 },
          { type: "BookOpened", player: 1, page: 42, digit: 2 },
          { type: "TurnWasted", player: 1, reason: "even_digit" },
          { type: "RoundStarted", round: 2, order: [1, 0] },
          { type: "BookOpened", player: 1, page: 17, digit: 7 },
          { type: "PartDrawn", player: 1, slot: 7, part: "head", stage: 1 },
        ]}
      />,
    );
    const html = raw.replace(/<!-- -->/g, "");
    expect(html.indexOf("Round 2")).toBeLessThan(html.indexOf("Round 1"));
    expect(html).toContain("You open page 13. You draw a head on slot 3.");
    expect(html).toContain("Ben opens page 42. Even digit: no game.");
  });
});
