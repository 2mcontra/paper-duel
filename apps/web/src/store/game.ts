import { create } from "zustand";
import {
  LOG_TAIL,
  type CardPlay,
  type GameEvent,
  type GameView,
  type Move,
  type PlayerIndex,
  type RulesOverrides,
} from "@paper-duel/engine";
import type {
  ClientMessage,
  Emote,
  ErrorCode,
  RoomView,
  ServerMessage,
} from "@paper-duel/protocol";
import { buzz, isMuted, play, setMuted } from "../audio.js";
import { GameSocket, defaultSocketUrl, type ConnectionStatus } from "../net/socket.js";
import { STEP_MS, applyEvent, needsReveal } from "../playback.js";

const NAME_KEY = "paper-duel:name";

export interface Toast {
  id: number;
  code: ErrorCode | "info";
  message: string;
}

export interface EmoteBubble {
  id: number;
  from: PlayerIndex;
  emote: Emote;
}

export interface GameStore {
  connection: ConnectionStatus;
  name: string;
  you: PlayerIndex | null;
  code: string | null;
  room: RoomView | null;
  /** Your view of the game: other players' hands and unfinished goes are hidden. */
  game: GameView | null;
  /** Events from the latest update, for highlighting what just happened. */
  lastEvents: GameEvent[];
  /** Players the server played for in the latest update (their turn timer ran out). */
  lastAuto: PlayerIndex[];
  /**
   * While events are being played back: the board as replayed so far (behind `game`, which
   * is already the server's final state). null when nothing is playing back.
   */
  shown: GameView | null;
  /** The event being shown right now, with a sequence number to restart animations. */
  current: { event: GameEvent; seq: number } | null;
  reveal: { done: number; total: number } | null;
  muted: boolean;
  timer: { turn: number; deadline: number | null } | null;
  emotes: EmoteBubble[];
  /** Server clock minus local clock, so countdowns match the server. */
  clockOffset: number;
  /** An action is in flight; block double clicks until the server answers. */
  busy: boolean;
  toasts: Toast[];

  setName(name: string): void;
  createRoom(): void;
  joinRoom(code: string): void;
  quickMatch(): void;
  configure(change: { rules?: RulesOverrides; maxPlayers?: number }): void;
  setReady(ready: boolean): void;
  start(): void;
  playCard(play: CardPlay): void;
  openBook(): void;
  act(move: Move): void;
  emote(emote: Emote): void;
  rematch(): void;
  leave(): void;
  dismissToast(id: number): void;
  skipReveal(): void;
  toggleMute(): void;
}

let socket: GameSocket | null = null;
let nextId = 0;
let seq = 0;
let queue: GameEvent[] = [];
let stepTimer: ReturnType<typeof setTimeout> | null = null;

const reducedMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
/** Set when the store is created; the socket forwards every server message here. */
let handleMessage: (msg: ServerMessage) => void = () => {};

const initialName = (() => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
})();

const SEATLESS = {
  you: null,
  code: null,
  room: null,
  game: null,
  lastEvents: [],
  lastAuto: [],
  shown: null,
  current: null,
  reveal: null,
  timer: null,
  emotes: [],
  busy: false,
} satisfies Partial<GameStore>;

export const useGame = create<GameStore>()((set, get) => {
  const send = (msg: ClientMessage, busy = false) => {
    if (!socket?.send(msg)) {
      toast("info", "Not connected. Reconnecting...");
      return;
    }
    if (busy) set({ busy: true });
  };

  const toast = (code: Toast["code"], message: string) => {
    const t = { id: ++nextId, code, message };
    set((s) => ({ toasts: [...s.toasts.slice(-2), t] }));
    setTimeout(() => get().dismissToast(t.id), 4000);
  };

  // ----- round reveal -----
  const sfx = (e: GameEvent) => {
    const you = get().you;
    switch (e.type) {
      case "BookOpened":
        return play("flip");
      case "PartDrawn":
        return play("pencil");
      case "FigureMoved":
        return play("step");
      case "Stomped":
        if (e.target === you) buzz([60, 30, 60]);
        return play("stomp");
      case "ShotFired":
        if (e.player === you) buzz(30);
        return play("pew");
      case "FigureKilled":
        if (e.target === you) buzz([80, 40, 80]);
        return play("boom");
      case "ShieldBroken":
        return play("clang");
      case "Passed":
        return play("miss");
      case "CardDrawn":
        return play("chime");
      case "CardPlayed":
        return play("card");
      case "PlayerOut":
        return play(e.player === you ? "lose" : "out");
      case "GameOver":
        return play(e.winner === you ? "win" : "lose");
      default:
        return;
    }
  };

  const finishReveal = () => {
    if (stepTimer) clearTimeout(stepTimer);
    stepTimer = null;
    queue = [];
    set({ shown: null, current: null, reveal: null });
  };

  const step = () => {
    stepTimer = null;
    const instant = reducedMotion();
    for (;;) {
      const e = queue.shift();
      if (!e) return finishReveal();
      const base = get().shown ?? get().game;
      if (!base) return finishReveal();
      const r = get().reveal;
      set({
        shown: applyEvent(base, e),
        current: { event: e, seq: ++seq },
        reveal: r ? { ...r, done: r.done + 1 } : null,
      });
      // Fall behind and the playback speeds up, so the board never lags far behind the game.
      const catchUp = queue.length > 10 ? 0.15 : queue.length > 4 ? 0.45 : 1;
      const ms = instant ? 0 : Math.round((STEP_MS[e.type] ?? 0) * catchUp);
      if (ms > 0) {
        sfx(e);
        stepTimer = setTimeout(step, ms);
        return;
      }
    }
  };

  /** Queues events for playback, starting from the board shown before this update. */
  const startReveal = (before: GameView, events: GameEvent[]) => {
    const fresh = events;
    if (!get().reveal) {
      set({ shown: before, reveal: { done: 0, total: 0 } });
    }
    queue.push(...fresh);
    set((st) => ({ reveal: st.reveal && { ...st.reveal, total: st.reveal.total + fresh.length } }));
    if (!stepTimer) step();
  };

  handleMessage = (msg) => {
    switch (msg.type) {
      case "joined":
        socket?.setToken(msg.sessionToken);
        return set({ you: msg.you, code: msg.code, busy: false });
      case "room_state":
        return set({ room: msg.room, ...(msg.room.phase === "lobby" ? { game: null } : {}) });
      case "game_started":
        finishReveal();
        return set({ game: msg.game, lastEvents: [], lastAuto: [], busy: false });
      case "game_state":
        finishReveal();
        return set({ game: msg.game, busy: false });
      case "game_update": {
        const before = get().game;
        // Updates don't resend the log; extend the one we have.
        const log = [...(before?.log ?? []), ...msg.events].slice(-LOG_TAIL);
        set({
          game: { ...msg.game, log },
          lastEvents: msg.events,
          lastAuto: msg.auto,
          busy: false,
        });
        if (before && needsReveal(msg.events)) startReveal(before, msg.events);
        return;
      }
      case "turn_timer":
        if (get().game?.turn.player === get().you) play("yourturn");
        return set({ timer: { turn: msg.turn, deadline: msg.deadline } });
      case "game_over":
        return set({ game: msg.game, timer: null, busy: false });
      case "emote": {
        const bubble = { id: ++nextId, from: msg.from, emote: msg.emote };
        set((s) => ({ emotes: [...s.emotes.filter((e) => e.from !== msg.from), bubble] }));
        play("pop");
        setTimeout(
          () => set((s) => ({ emotes: s.emotes.filter((e) => e.id !== bubble.id) })),
          3000,
        );
        return;
      }
      case "left":
        finishReveal();
        socket?.setToken(null);
        if (msg.reason === "replaced") toast("info", "This game was opened in another tab.");
        if (msg.reason === "idle")
          toast("info", "The room was closed because nobody played for a while.");
        return set(SEATLESS);
      case "pong":
        return set({ clockOffset: msg.serverTime - Date.now() });
      case "error":
        set({ busy: false });
        if (msg.code === "session_not_found") {
          socket?.setToken(null);
          set(SEATLESS);
          return toast(msg.code, "Your previous game has ended.");
        }
        return toast(msg.code, msg.message);
    }
  };

  return {
    connection: "connecting",
    name: initialName,
    ...SEATLESS,
    clockOffset: 0,
    toasts: [],
    muted: isMuted(),

    setName(name) {
      set({ name });
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        // ignore
      }
    },
    createRoom: () => send({ type: "create_room", name: get().name }, true),
    joinRoom: (code) => send({ type: "join_room", code, name: get().name }, true),
    quickMatch: () => send({ type: "quick_match", name: get().name }, true),
    configure: (change) => send({ type: "configure", ...change }),
    setReady: (ready) => send({ type: "ready", ready }),
    start: () => send({ type: "start" }),
    playCard: (play) => {
      if (get().busy) return;
      send({ type: "play_card", play }, true);
    },
    openBook() {
      if (get().busy || get().reveal) return;
      play("flip");
      send({ type: "open_book" }, true);
    },
    act: (move) => {
      if (get().busy || get().reveal) return;
      send({ type: "act", move }, true);
    },
    emote: (emote) => send({ type: "emote", emote }),
    rematch: () => send({ type: "rematch" }),
    leave: () => send({ type: "leave" }),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    skipReveal() {
      // Jump to the end: the server's state is already in `game`.
      const last = queue.filter((e) => e.type === "GameOver").at(-1);
      if (last) sfx(last);
      finishReveal();
    },
    toggleMute() {
      setMuted(!get().muted);
      set({ muted: !get().muted });
    },
  } satisfies GameStore;
});

/** Connects the store to the server. Call once at startup. */
export function connectGame(url = defaultSocketUrl()): () => void {
  socket = new GameSocket(url, {
    onMessage: (msg) => handleMessage(msg),
    onStatus: (connection) => useGame.setState({ connection }),
  });
  socket.start();
  return () => socket?.stop();
}
