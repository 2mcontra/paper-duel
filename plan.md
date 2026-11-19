# Paper Duel Online: Build Plan

A 2-player multiplayer browser version of the pen-and-paper stick-figure gun duel, where the real book is replaced by a **virtual book**. Players flip to a random page, and the last digit of the page number decides which slot they act on.

---

## 1. Game Rules (as implemented)

### 1.1 Core rules from the video
- 2 players, each with their own column of **5 slots** numbered **1, 3, 5, 7, 9** (odd only, fixed and not configurable).
- A turn starts by opening the virtual book at a random page. Only the **last digit** of the page number matters.
  - Odd digit (1, 3, 5, 7, 9): the player acts on that slot.
  - Even digit (0, 2, 4, 6, 8): no game, the turn is wasted.
- Each slot builds a stick figure one part per action, in this order:
  1. Head
  2. Body
  3. Face
  4. Gun
  5. Load 3 bullets (the figure is now "armed")
- An armed figure can attack the opponent's **same-numbered slot**.
  - If the opponent has a gun built on that slot, that slot is **eliminated**.
- An eliminated slot is dead permanently and can never be redrawn.
- **Win:** first to eliminate 3 of the opponent's slots (best of 5, see R11). The literal rule of eliminating all 5 is available as `winTarget: 5`.

### 1.2 Ambiguities and proposed defaults
The video leaves these open. Each is a **configurable rule option** (`RulesConfig`), with the default shown.

| # | Question | Default | Alternative |
|---|----------|---------|-------------|
| R1 | Slot numbers: the comment says 1,3,5,7,9, the paper shows 0,2,4,6,8 | **Decided: odd only (1,3,5,7,9)** | None, not configurable |
| R2 | Who starts | Random coin flip | Host starts |
| R3 | Rolled slot is armed | Auto-attack the opponent's same slot | Player chooses attack or skip |
| R4 | Attack when the opponent has no gun on that slot | Miss, no effect | Opponent's partial figure is destroyed |
| R5 | Bullets after firing | Consumed: figure drops back to the "gun, 0 bullets" stage | Reusable |
| R6 | Rolled slot is dead (yours) | Turn wasted | Reroll |
| R7 | Rolled slot is dead (opponent's) | N/A, only matters when attacking: treated as a miss | N/A |
| R8 | Does an attack take the whole turn | Yes, one action per turn | N/A |
| R9 | Book pages | 1 to 300, uniform | Configurable |
| R10 | Turn timer | 30 s, auto-roll on timeout | Off |
| R11 | Win condition. Literal rules (wipe out all 5) almost never finish: M1 simulation showed about 95% of games reach a point where no slot number is alive on both sides | **Decided: best of 5, first to 3 fights won** (`winTarget: 3`) | `winTarget` 1 to 5; with 4 or 5, a stalled game goes to the player with more living slots, or a draw |

**Status:** defaults confirmed.

---

## 2. Virtual Book Design

### 2.1 Concept
A 3D-ish or 2D flipbook UI. The player clicks "Open Book" and the pages flip rapidly, then settle on a page with a big page number. The **server** picks the page. The client only animates toward it.

### 2.2 Randomness and fairness
- The server picks `page = 1 + crypto.randomInt(0, totalPages)`. Never use `Math.random()` and never trust the client.
- Make `totalPages` a multiple of 10 (default 300) so each last digit has exactly equal probability.
- Optional **provably fair** mode:
  1. At game start, the server commits `hash(serverSeed)` and sends it to both players.
  2. Each page is `HMAC(serverSeed, gameId + turnIndex + clientSeedA + clientSeedB)` mod totalPages.
  3. At game end, the server reveals `serverSeed` so both players can verify the whole game.
  This is a good showcase feature but not needed for the MVP.

### 2.3 Book UI
- Flip animation: CSS 3D transforms (`rotateY`) on 3 or 4 stacked page elements, or a canvas/WebGL page curl later.
- Flip duration is about 1.2 s, slowing toward the final page, so the player can't tell the result early.
- The final page shows the large page number with the **last digit highlighted**, then a banner: "Digit 7 → Slot 7" or "Digit 4 → even, no game".
- Page content is decorative, for example paper texture and tiny random doodles seeded by page number, so each page looks different.
- Sound: page-flip rustle, a thud on landing.
- Both players see the opponent's flip live, using the same server-sent result and a synchronised animation.

---

## 3. Architecture

```
┌──────────────┐   WebSocket (JSON)   ┌─────────────────────────┐
│ Browser (A)  │◄────────────────────►│  Game Server (Node.js)  │
│ React + SVG  │                      │  - Room manager         │
└──────────────┘                      │  - Authoritative engine │
┌──────────────┐                      │  - RNG / book           │
│ Browser (B)  │◄────────────────────►│  - Timers               │
└──────────────┘                      └───────────┬─────────────┘
                                                  │ (optional)
                                           ┌──────▼──────┐
                                           │ Redis / SQLite │
                                           └─────────────┘
```

**Key principle: the server is authoritative.** Clients send *intents* ("roll", "ready"). The server validates them, advances state, and broadcasts the new state. Clients never compute game outcomes.

### 3.1 Tech stack (proposed)
- **Language:** TypeScript everywhere (shared types between client and server).
- **Monorepo:** `pnpm` workspaces with `packages/engine`, `apps/server`, `apps/web`.
- **Server:** Node.js, `ws` or Socket.IO, Fastify for HTTP (health check, static files).
- **Client:** React + Vite, Zustand for state, SVG for the stick figures (easy to animate drawing strokes), Framer Motion or CSS for the book flip.
- **Validation:** `zod` schemas for every WebSocket message.
- **Persistence:** in-memory for the MVP. Later SQLite or Redis for reconnects and match history.
- **Testing:** Vitest (engine and server), Playwright (two-browser end-to-end).
- **Deploy:** one Docker image (server serves the built client), behind a reverse proxy with TLS (`wss://`).

---

## 4. Game Engine (`packages/engine`)

A **pure, deterministic, side-effect-free** module. It takes a state and an action and returns a new state, so it is trivial to unit test.

### 4.1 Types

```ts
type Stage = 0 | 1 | 2 | 3 | 4 | 5; // 0 empty, 1 head, 2 body, 3 face, 4 gun, 5 loaded
type SlotStatus = "alive" | "eliminated";

interface Slot { number: 1|3|5|7|9; stage: Stage; status: SlotStatus }

interface PlayerState { id: string; name: string; slots: Slot[] }

type Phase = "lobby" | "ready_check" | "playing" | "finished";

interface GameState {
  id: string;
  phase: Phase;
  players: [PlayerState, PlayerState];
  turn: 0 | 1;            // index of the player whose turn it is
  turnIndex: number;      // increments every turn (used for seeding and replays)
  lastRoll?: { page: number; digit: number };
  log: GameEvent[];       // append-only event log
  winner?: 0 | 1;
  rules: RulesConfig;
}
```

### 4.2 Core function

```ts
function resolveTurn(state: GameState, page: number): { state: GameState; events: GameEvent[] }
```

Logic:
1. `digit = page % 10`.
2. If the digit is even, emit `TurnWasted`, pass the turn.
3. Else `slot = current player's slot[digit]`.
   - Dead: `TurnWasted` (R6).
   - `stage < 5`: `stage++`, emit `PartDrawn { slot, part }`.
   - `stage == 5`: attack. Look up the opponent's slot `digit`.
     - Opponent slot alive and `stage >= 4`: emit `SlotEliminated`.
     - Otherwise: emit `AttackMissed`.
     - Apply R5 (bullets consumed or not).
4. If all 5 of the opponent's slots are eliminated: emit `GameWon`, set `phase = "finished"`.
5. Otherwise pass the turn.

The page number is an **input** to `resolveTurn`, so the engine stays deterministic and a game can be replayed from its log.

### 4.3 Engine tests (must pass before the server work)
- Parts are drawn in the correct order, and exactly 5 actions arm a slot.
- Even digits waste the turn.
- A dead slot can't be rebuilt, and rolling it wastes the turn.
- An attack on a slot with a gun eliminates it.
- An attack on an empty or partial slot misses (default R4).
- Win detection triggers on the 5th elimination.
- Turn order alternates correctly.
- Property test: random games always terminate with a winner or a valid state (cap at N turns for infinite-stalemate detection).
- Each `RulesConfig` variant is covered.

---

## 5. Network Protocol

All messages are JSON, validated with zod. A `type` field discriminates.

Schemas and types live in `packages/protocol`, shared by server and client.

### 5.1 Client → Server
| Message | Payload | Purpose |
|---------|---------|---------|
| `create_room` | `{ name, rules? }` | Make a room and get a code |
| `join_room` | `{ code, name }` | Join with a 5-character code (case-insensitive) |
| `quick_match` | `{ name }` | Join a waiting public room, or open one |
| `set_rules` | `{ rules }` | Host only, lobby only. Clears both ready flags |
| `ready` | `{ ready }` | Set or clear ready; the game starts when both are ready |
| `open_book` | `{}` | Request the roll for the current turn |
| `choose` | `{ attack }` | Under R3 "choose": fire or hold an armed slot |
| `rematch` | `{}` | Vote for a rematch |
| `leave` | `{}` | Leave the room (forfeits a game in progress) |
| `resume` | `{ sessionToken }` | Reconnect after a drop |
| `ping` | `{}` | Keep-alive and clock sync |

### 5.2 Server → Client
| Message | Payload |
|---------|---------|
| `joined` | `{ protocol, sessionToken, you, code }`: you hold a seat. Re-sent if your seat index changes |
| `room_state` | `{ room }`: lobby snapshot (seats, ready, connected, rematch votes, rules) |
| `game_started` | `{ game }`: a new game began |
| `game_state` | `{ game }`: snapshot of the current game, sent on resume |
| `turn_result` | `{ events, game, auto }`: one action and its result. `auto` means the turn timer acted |
| `turn_timer` | `{ player, deadline }`: whose move it is; `deadline` is epoch ms or null |
| `opponent_status` | `{ connected, graceDeadline }` |
| `game_over` | `{ winner, reason, game }` |
| `left` | `{ reason }`: you no longer hold a seat (`you_left`, `replaced`) |
| `pong` | `{ serverTime }` |
| `error` | `{ code, message }` |

Players see absolute indices plus `you`; the client puts `you` on the left.

### 5.3 Rules enforced server-side
- Only the player whose turn it is can send `open_book`, and only once per turn.
- Messages are rate limited (for example 10 per second per socket).
- Reject malformed payloads and unknown message types.
- Unique unguessable `sessionToken` per player, used for reconnect.

---

## 6. UI/UX Plan

### 6.1 Screens
1. **Landing:** name input, "Create Room", "Join with Code", "Quick Match".
2. **Lobby:** room code (copy button), player list, ready toggles, rules summary (host can tweak R2 to R10).
3. **Game board** (main screen, see below).
4. **Game over:** winner banner, final boards, "Rematch" and "Leave".
5. **How to play:** short illustrated version of the rules (also useful for sharing the video's concept).

### 6.2 Game board layout
- A **notebook-paper** look: ruled lines, a margin line, hand-drawn font (for example *Caveat* or *Patrick Hand*), a slight paper texture.
- Two columns divided by a vertical line, with slot numbers in the left margin like the video (1, 3, 5, 7, 9 down the page).
- Your column is always on the left, and the opponent's is on the right (the server sends relative indices).
- The virtual book sits at the bottom or in a side panel, with an "Open Book" button (only enabled on your turn).
- A turn indicator, a countdown ring, and an event log feed ("You drew a gun on slot 5").

### 6.3 Stick figure rendering
- Each slot is an SVG group with 5 layered parts: head, body, face, gun, bullets (3 dots).
- Parts appear by animating `stroke-dashoffset`, so it looks hand-drawn.
- Wobbly strokes: render paths with a small random jitter seeded by slot number, so it looks sketchy but is stable across redraws.
- Eliminated slot: a big red X scribble, with the figure greyed out.
- **Attack animation:** a curved line animates from the attacker's gun to the target slot, like the curved lines in the video. On a hit, the target figure is scribbled out. On a miss, the line fades.
- Both players see all the animations in sync, driven by server events.

### 6.4 Feedback and polish
- Sounds: page flip, pencil scratch, gunshot "pew", elimination sting, win fanfare (mute toggle).
- Haptics on mobile (`navigator.vibrate`).
- Responsive layout: the board must work on a phone in portrait, since many people will play on mobile.
- Accessibility: keyboard-operable (Space to open the book), colour-blind-safe markers, and a `prefers-reduced-motion` mode that skips the flip animation.
- Optional language toggle: English and Tamil (the video is Tamil), with i18n strings from day one.

---

## 7. Milestones

### M0: Project setup (0.5 day)
- Create the pnpm monorepo, TypeScript config, ESLint, Prettier, Vitest.
- GitHub Actions CI: lint, typecheck, test.

### M1: Engine (1 to 2 days)
- Implement the types, `resolveTurn`, `RulesConfig`, and win detection.
- Full unit test suite from section 4.3.
- A tiny CLI simulator (`pnpm sim`) that plays two random bots and prints the log, to sanity check game length and balance.
- **Exit criteria:** 10,000 simulated games all terminate with valid results.

### M2: Server (2 days)
- Fastify and WebSocket setup, zod message schemas.
- Room manager: create, join, ready, start, leave.
- Server-side book RNG with `crypto.randomInt`.
- Turn loop with timers, and auto-roll on timeout.
- Reconnect with `sessionToken` (a 60 s grace period before forfeit).
- Integration tests with two simulated socket clients playing a full game.

### M3: Client MVP (3 days)
- Landing, lobby, and board screens.
- WebSocket client with auto-reconnect and a Zustand store.
- Plain (unanimated) SVG stick figures and a basic "Open Book" button that shows the page number.
- **Exit criteria:** two browser tabs can play a complete game end to end.

### M4: The virtual book and animations (2 to 3 days)
- 3D page-flip animation landing on the server-chosen page.
- Pencil-draw animation for parts, the attack line animation, and the elimination X.
- Sound effects, mobile layout, and reduced-motion mode.

### M5: Hardening (1 to 2 days)
- Rate limiting, input validation audit, and max message size.
- Idle room cleanup and a cap on concurrent rooms.
- Playwright end-to-end test with two browser contexts, including a disconnect and reconnect scenario.
- Load test: 200 concurrent rooms.

### M6: Deploy (1 day)
- Multi-stage Dockerfile (build client, run server).
- Reverse proxy config with TLS and WebSocket upgrade headers.
- Health endpoint, structured logging, and basic metrics (active rooms, games per hour).

### M7: Extras (as time allows)
- Provably fair mode (commit-reveal, section 2.2).
- Bot opponent for solo play.
- Spectator mode.
- Replay viewer from the event log.
- Match history and leaderboard.
- Custom rules in the lobby (the R2 to R10 options).
- Tamil localisation.
- Share link or QR code for joining a room.

---

## 8. Security and Anti-Cheat

- **No client trust:** all randomness and all state transitions happen on the server.
- **Origin check:** reject WebSocket upgrades from unexpected origins.
- **Room codes:** 5 or 6 characters from an unambiguous alphabet (no 0/O, 1/I), with attempt limiting to prevent brute-force joining.
- **Session tokens:** random 128-bit values, never reused across games.
- **Input limits:** player names are length-limited and sanitised (React escapes by default, but still strip control characters).
- **DoS controls:** per-IP connection cap, per-socket message rate limit, max payload size, idle timeouts.
- **Transport:** TLS only in production (`wss://`).
- **Privacy:** no accounts or personal data in the MVP, only a display name and an ephemeral session.

---

## 9. Project Structure

```
paper-duel/
├─ packages/
│  └─ engine/            # pure game logic + tests
│     ├─ src/{types,rules,resolveTurn,rng}.ts
│     └─ test/
├─ apps/
│  ├─ server/            # Fastify + ws
│  │  └─ src/{index,rooms,protocol,timers,session}.ts
│  └─ web/               # React + Vite
│     └─ src/
│        ├─ screens/{Landing,Lobby,Board,GameOver}.tsx
│        ├─ components/{Book,Slot,StickFigure,AttackLine,EventLog}.tsx
│        ├─ net/socket.ts
│        └─ store/game.ts
├─ Dockerfile
├─ plan.md
└─ README.md
```

---

## 10. Open Questions

1. ~~Confirm the rule defaults in section 1.2.~~ Settled: R1 is odd slots only, and all other defaults are confirmed.
2. Should the book be one shared virtual book, or does each player get their own? (Default: a single shared book, server-rolled.)
3. Is the game only for 2 players, or should a 3 or 4 player free-for-all be considered later?
4. Public matchmaking or private room codes only for launch?
5. Hosting target and domain (the Docker setup can run on any small VPS or home server).

---

## 11. Definition of Done (MVP)

- Two players on different devices can create or join a room, play a full game, and see a winner.
- Every roll is generated on the server, and the book animation lands on the server's page.
- The game follows the rules in section 1 with the chosen defaults.
- A disconnect and reconnect within 60 s resumes the game.
- Engine tests and the two-browser end-to-end test pass in CI.
- The app is deployed behind TLS and playable on mobile.
