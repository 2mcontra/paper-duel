import { expect, test, type Browser, type Page } from "@playwright/test";

const NAMES = ["Asha", "Bala", "Chitra", "Dev", "Esha", "Farid"];

/**
 * Opens `count` players in separate browser contexts (separate sessions), creates a room,
 * sets the rules, readies everyone and starts the game. The host always goes first and there
 * is no turn timer. Returns pages in seat order.
 */
async function startParty(
  browser: Browser,
  count: number,
  setup: { figures?: string; rounds?: string; reducedMotion?: boolean } = {},
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
  const rule = (label: string) => host.locator(".rule", { hasText: label }).locator("select");
  await rule("Who goes first").selectOption("host");
  await rule("Turn timer").selectOption("null");
  if (setup.figures) await rule("Figures each").selectOption(setup.figures);
  if (setup.rounds) await rule("Round limit").selectOption(setup.rounds);
  const last = guests.at(-1)!;
  await expect(last.locator(".rule", { hasText: "Turn timer" }).locator("dd")).toHaveText("Off");
  for (const p of pages) await p.getByTestId("ready").click();
  await expect(host.getByTestId("start")).toBeEnabled();
  await host.getByTestId("start").click();
  for (const p of pages) await expect(p.getByTestId("track")).toBeVisible();
  await expect(host.getByTestId("open-book")).toBeVisible();
  return pages;
}

/**
 * One pass over every player: open the book if it's their turn, or pick a move (shoot if
 * possible, else draw, else walk, else pass).
 */
async function step(pages: Page[]): Promise<void> {
  for (const p of pages) {
    // Buttons can vanish between these calls (the turn ends, playback starts), so never let
    // a check wait for one to come back.
    const open = p.getByTestId("open-book");
    if ((await open.count()) && (await open.isEnabled({ timeout: 200 }).catch(() => false))) {
      await open.click({ timeout: 2000 }).catch(() => {});
      return;
    }
    const choices = p.getByTestId("choices");
    if (await choices.count()) {
      for (const sel of [
        "[data-testid^=shoot-]",
        "[data-testid^=draw-]",
        "[data-testid^=move-]",
        "[data-testid=pass]",
      ]) {
        const btn = choices.locator(sel).first();
        if (await btn.count()) {
          await btn.click({ timeout: 2000 }).catch(() => {});
          return;
        }
      }
    }
  }
}

async function playUntilOver(pages: Page[], timeoutMs = 75_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (!(await pages[0]!.getByTestId("game-over").isVisible())) {
    if (Date.now() > deadline) throw new Error("game did not finish in time");
    await step(pages);
  }
  for (const p of pages) await expect(p.getByTestId("game-over")).toBeVisible();
  return Promise.all(pages.map((p) => p.locator(".gameover__title").innerText()));
}

test("three players play a full game to a podium, then rematch", async ({ browser }) => {
  const pages = await startParty(browser, 3, { figures: "1", rounds: "10" });
  const results = await playUntilOver(pages);
  expect(results.filter((r) => r === "You win!").length).toBeLessThanOrEqual(1);
  for (const r of results) expect(r).toMatch(/^(You win!|Draw!|You came (1st|2nd|3rd))$/);

  // Everyone sees the same standings, awards and series score.
  const standings = await Promise.all(pages.map((p) => p.locator(".standings").innerText()));
  const strip = (s: string) => s.replace(/ \(you\)/g, "");
  for (const s of standings) expect(strip(s)).toBe(strip(standings[0]!));
  await expect(pages[0]!.locator(".podium__spot")).not.toHaveCount(0);
  await expect(pages[0]!.locator(".series tbody tr")).toHaveCount(3);

  for (const p of pages) await p.getByTestId("rematch").click();
  for (const p of pages) await expect(p.getByTestId("track")).toBeVisible();
  await expect(pages[0]!.locator(".roundbar__round")).toHaveText("Round 1");
  await expect(pages[0]!.getByTestId("open-book")).toBeVisible();
});

test("a player who drops out mid-game reconnects to the same seat", async ({ browser }) => {
  const [host, guest] = (await startParty(browser, 2)) as [Page, Page];
  for (let i = 0; i < 4; i++) await step([host, guest]);

  // The guest's tab navigates away (socket closes) ...
  const url = guest.url();
  await guest.goto("about:blank");
  await expect(host.getByTestId("status-1")).toHaveText("offline");

  // ... and comes back: the session in sessionStorage resumes the same seat.
  await guest.goto(url);
  await expect(guest.getByTestId("player-1")).toContainText("Bala (you)");
  await expect(host.getByTestId("status-1")).not.toHaveText("offline");

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
  for (const p of [a, b]) await expect(p.getByTestId("status-2")).toHaveText("left");
  await expect(a.locator(".log")).toContainText("Chitra left the game.");

  // Turns skip Chitra: Asha, Bala, then Asha again in round 2.
  for (const p of [a, b]) {
    await p.getByTestId("open-book").click();
    await p.getByTestId("pass").click();
  }
  await expect(a.locator(".roundbar__round")).toHaveText("Round 2");
  await expect(a.getByTestId("open-book")).toBeVisible();
});

test("with motion on, each move plays back before the next turn", async ({ browser }) => {
  const [host, guest] = (await startParty(browser, 2, { reducedMotion: false })) as [Page, Page];
  await host.getByTestId("open-book").click();
  await expect(host.getByTestId("revealing")).toBeVisible();
  await expect(host.getByTestId("choices")).toBeVisible();
  await expect(host.getByTestId("book")).toContainText(/roll \d+/);
  await host.getByTestId("draw-0").click();
  await expect(guest.getByTestId("revealing")).toBeVisible();
  await expect(guest.getByTestId("open-book")).toBeVisible();
  await expect(guest.locator(".log")).toContainText("Asha draws a face on A.");
});
