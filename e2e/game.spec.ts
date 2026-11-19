import { expect, test, type Browser, type Page } from "@playwright/test";

const NAMES = ["Asha", "Bala", "Chitra", "Dev", "Esha", "Farid"];

/**
 * Opens `count` players in separate browser contexts (separate sessions), creates a room,
 * sets the rules, readies everyone and starts the game. Returns pages in seat order.
 */
async function startParty(
  browser: Browser,
  count: number,
  setup: { lives?: string; reducedMotion?: boolean } = {},
): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < count; i++) {
    const ctx = await browser.newContext(
      setup.reducedMotion === false ? { reducedMotion: "no-preference" } : {},
    );
    const page = await ctx.newPage();
    page.on("pageerror", (err) => {
      throw err;
    });
    await page.goto("/");
    await page.getByPlaceholder("Who's duelling?").fill(NAMES[i]!);
    pages.push(page);
  }
  const [host, ...guests] = pages as [Page, ...Page[]];
  await host.getByRole("button", { name: "Create room" }).click();
  const code = (await host.getByTestId("room-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  for (const g of guests) {
    await g.getByPlaceholder("ABCDE").fill(code.toLowerCase());
    await g.getByRole("button", { name: "Join" }).click();
    await expect(g.getByTestId("room-code")).toHaveText(code);
  }
  if (setup.lives) {
    await host.locator(".rule", { hasText: "Lives" }).locator("select").selectOption(setup.lives);
    for (const g of guests) {
      await expect(g.locator(".rule", { hasText: "Lives" }).locator("dd")).toHaveText(
        new RegExp(`^${setup.lives}`),
      );
    }
  }
  for (const p of pages) await p.getByTestId("ready").click();
  await expect(host.getByTestId("start")).toBeEnabled();
  await host.getByTestId("start").click();
  for (const p of pages) await expect(p.getByTestId("open-book")).toBeVisible();
  return pages;
}

/** One pass over every player: aim if asked, otherwise open the book if it's their go. */
async function step(pages: Page[]): Promise<void> {
  await Promise.all(
    pages.map(async (p) => {
      const aim = p.locator(".opp--aimable");
      if (await aim.count())
        return aim
          .first()
          .click()
          .catch(() => {});
      const open = p.getByTestId("open-book");
      if ((await open.count()) && (await open.isEnabled())) await open.click().catch(() => {});
    }),
  );
}

async function playUntilOver(pages: Page[], timeoutMs = 60_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (!(await pages[0]!.getByTestId("game-over").isVisible())) {
    if (Date.now() > deadline) throw new Error("game did not finish in time");
    await step(pages);
  }
  for (const p of pages) await expect(p.getByTestId("game-over")).toBeVisible();
  return Promise.all(pages.map((p) => p.locator(".gameover__title").innerText()));
}

test("three players play a full game to one winner, then rematch", async ({ browser }) => {
  const pages = await startParty(browser, 3, { lives: "1" });
  const results = await playUntilOver(pages);
  expect(results.filter((r) => r === "You win!")).toHaveLength(1);
  expect(results.filter((r) => r === "Game over")).toHaveLength(2);

  // Everyone's log names the same winner (as "You win!" for the winner themselves).
  const winnerSeat = results.indexOf("You win!");
  const logs = await Promise.all(pages.map((p) => p.locator(".log").innerText()));
  logs.forEach((log, i) =>
    expect(log).toContain(i === winnerSeat ? "🏆 You win!" : `🏆 ${NAMES[winnerSeat]} wins!`),
  );

  for (const p of pages) await p.getByTestId("rematch").click();
  for (const p of pages) await expect(p.getByTestId("open-book")).toBeVisible();
  await expect(pages[0]!.locator(".roundbar__round")).toHaveText("Round 1");
});

test("a player who drops out mid-game reconnects to the same seat", async ({ browser }) => {
  const [host, guest] = (await startParty(browser, 2)) as [Page, Page];
  for (let i = 0; i < 3; i++) await step([host, guest]);

  // The guest's tab navigates away (socket closes) ...
  const url = guest.url();
  await guest.goto("about:blank");
  await expect(host.getByTestId("opp-1").locator(".opp__status")).toHaveText("offline");

  // ... and comes back: the session in sessionStorage resumes the same seat.
  await guest.goto(url);
  await expect(guest.locator(".myboard__name")).toContainText("Bala (you)");
  await expect(host.getByTestId("opp-1").locator(".opp__status")).not.toHaveText("offline");

  // The game carries on for both.
  const round = Number((await host.locator(".roundbar__round").innerText()).replace(/\D/g, ""));
  await expect(async () => {
    await step([host, guest]);
    const now = Number((await host.locator(".roundbar__round").innerText()).replace(/\D/g, ""));
    expect(now).toBeGreaterThan(round);
  }).toPass({ timeout: 15_000 });
});

test("leaving mid-game knocks you out and the others play on", async ({ browser }) => {
  const [a, b, c] = (await startParty(browser, 3)) as [Page, Page, Page];
  c.once("dialog", (d) => void d.accept());
  await c.getByTestId("leave-game").click();
  await expect(c.getByRole("button", { name: "Create room" })).toBeVisible(); // back to the start
  for (const p of [a, b])
    await expect(p.getByTestId("opp-2").locator(".opp__status")).toHaveText("left");
  await expect(a.locator(".log")).toContainText("Chitra left the game.");

  // The round no longer waits for Chitra.
  await a.getByTestId("open-book").click();
  await b.getByTestId("open-book").click();
  await expect(a.locator(".roundbar__round")).toHaveText("Round 2");
});

test("the round reveal plays back with motion on, and can be skipped", async ({ browser }) => {
  const [host, guest] = (await startParty(browser, 2, { reducedMotion: false })) as [Page, Page];
  await host.getByTestId("open-book").click();
  await guest.getByTestId("open-book").click();
  await expect(host.getByTestId("revealing")).toBeVisible();
  await host.getByTestId("skip").click();
  await expect(host.getByTestId("revealing")).toHaveCount(0);
  await expect(host.locator(".roundbar__round")).toHaveText("Round 2");
});
