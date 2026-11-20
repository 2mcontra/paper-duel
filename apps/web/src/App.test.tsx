import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createGame, viewFor } from "@paper-duel/engine";
import { BookPage } from "./components/Book.js";
import { EventLog } from "./components/EventLog.js";
import { MiniFigure, Track } from "./components/Track.js";
import { describeEvent } from "./text.js";

const ctx = { you: 0, names: ["Ann", "Ben", "Cat"] };

describe("describeEvent", () => {
  it("speaks to you and names the others", () => {
    expect(
      describeEvent({ type: "PartDrawn", player: 0, figure: 1, part: "gun", stage: 4 }, ctx),
    ).toBe("You draw a gun on B.");
    expect(
      describeEvent({ type: "PartDrawn", player: 2, figure: 0, part: "bullets", stage: 5 }, ctx),
    ).toBe("Cat draws bullets on A.");
    expect(
      describeEvent(
        {
          type: "ShotFired",
          player: 1,
          figure: 2,
          targets: [
            { player: 0, figure: 0 },
            { player: 2, figure: 1 },
          ],
        },
        ctx,
      ),
    ).toBe("🔫 Ben's C fires at your A and Cat's B!");
    expect(
      describeEvent(
        { type: "FigureKilled", player: 1, figure: 0, target: 0, targetFigure: 2 },
        ctx,
      ),
    ).toBe("BANG! Your C is gone.");
    expect(
      describeEvent(
        { type: "Stomped", player: 0, figure: 0, target: 2, targetFigure: 0, stage: 3 },
        ctx,
      ),
    ).toBe("🦶 STOMP! Cat's A is sent home.");
    expect(
      describeEvent({ type: "FigureMoved", player: 1, figure: 0, from: null, to: 13 }, ctx),
    ).toBe("Ben walks A out of home to square 14.");
    expect(
      describeEvent({ type: "PlayerOut", player: 1, reason: "shot", by: 0, place: 3 }, ctx),
    ).toBe("💀 Ben is out (3rd)!");
    expect(
      describeEvent({ type: "GameOver", winner: 0, reason: "last_standing", places: [1, 2] }, ctx),
    ).toBe("🏆 You win!");
    expect(describeEvent({ type: "TurnStarted", player: 1, round: 1, turn: 2 }, ctx)).toBeNull();
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

describe("MiniFigure", () => {
  it("adds parts by stage, and marks the dead with an X", () => {
    const count = (stage: number) =>
      (
        renderToString(
          <svg>
            <MiniFigure stage={stage} dead={false} color="red" shielded={false} />
          </svg>,
        ).match(/<(circle|path)/g) ?? []
      ).length;
    const counts = [1, 2, 3, 4, 5].map(count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(
      renderToString(
        <svg>
          <MiniFigure stage={4} dead color="red" shielded={false} />
        </svg>,
      ),
    ).toContain("mfig__x");
  });
});

describe("Track", () => {
  it("draws every square and every figure", () => {
    const game = viewFor(
      createGame({
        id: "g",
        players: ctx.names.map((name, i) => ({ id: `${i}`, name })),
        firstSeat: 0,
      }),
      0,
    );
    const html = renderToString(<Track game={game} you={0} />).replace(/<!-- -->/g, "");
    expect(html.match(/class="sq[ "]/g)).toHaveLength(30);
    expect(html.match(/data-fig=/g)).toHaveLength(9);
    expect(html).toContain("Ann (you)");
  });
});

describe("BookPage", () => {
  it("highlights the last digit and gives the roll", () => {
    const html = renderToString(<BookPage page={137} caption="Your page" />);
    expect(html).toContain("13<mark");
    expect(html).toContain("roll 7");
    expect(renderToString(<BookPage page={40} caption="x" />)).toContain("roll 10");
    expect(renderToString(<BookPage page={null} caption="Closed book" />)).toContain("Closed book");
  });
});

describe("EventLog", () => {
  it("one line per turn, newest first", () => {
    const raw = renderToString(
      <EventLog
        you={0}
        names={ctx.names}
        log={[
          { type: "TurnStarted", player: 0, round: 1, turn: 1 },
          { type: "BookOpened", player: 0, page: 13, roll: 3 },
          { type: "PartDrawn", player: 0, figure: 0, part: "face", stage: 3 },
          { type: "TurnStarted", player: 1, round: 1, turn: 2 },
          { type: "BookOpened", player: 1, page: 42, roll: 2 },
          { type: "Passed", player: 1 },
        ]}
      />,
    );
    const html = raw.replace(/<!-- -->/g, "");
    expect(html.indexOf("Ben opens")).toBeLessThan(html.indexOf("You open"));
    expect(html).toContain("You open page 13: roll 3. You draw a face on A.");
    expect(html).toContain("Ben opens page 42: roll 2. Ben passes.");
  });
});
