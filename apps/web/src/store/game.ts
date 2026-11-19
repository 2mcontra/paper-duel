import { create } from "zustand";
import type {
  CardPlay,
  GameEvent,
  GameView,
  PlayerIndex,
  RulesOverrides,
} from "@paper-duel/engine";
import type {
  ClientMessage,
  Emote,
  ErrorCode,
  RoomView,
  ServerMessage,
} from "@paper-duel/protocol";
import { GameSocket, defaultSocketUrl, type ConnectionStatus } from "../net/socket.js";

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
  /** Players the server acted for in the latest update (round timer ran out). */
  lastAuto: PlayerIndex[];
  timer: { round: number; deadline: number | null } | null;
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
  playCard(play: CardPlay | null): void;
  openBook(): void;
  setTarget(targets: PlayerIndex[]): void;
  emote(emote: Emote): void;
  rematch(): void;
  leave(): void;
  dismissToast(id: number): void;
}

let socket: GameSocket | null = null;
let nextId = 0;
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

  handleMessage = (msg) => {
    switch (msg.type) {
      case "joined":
        socket?.setToken(msg.sessionToken);
        return set({ you: msg.you, code: msg.code, busy: false });
      case "room_state":
        return set({ room: msg.room, ...(msg.room.phase === "lobby" ? { game: null } : {}) });
      case "game_started":
        return set({ game: msg.game, lastEvents: [], lastAuto: [], busy: false });
      case "game_state":
        return set({ game: msg.game, busy: false });
      case "game_update":
        return set({ game: msg.game, lastEvents: msg.events, lastAuto: msg.auto, busy: false });
      case "round_timer":
        return set({ timer: { round: msg.round, deadline: msg.deadline } });
      case "game_over":
        return set({ game: msg.game, timer: null, busy: false });
      case "emote": {
        const bubble = { id: ++nextId, from: msg.from, emote: msg.emote };
        set((s) => ({ emotes: [...s.emotes.filter((e) => e.from !== msg.from), bubble] }));
        setTimeout(
          () => set((s) => ({ emotes: s.emotes.filter((e) => e.id !== bubble.id) })),
          3000,
        );
        return;
      }
      case "left":
        socket?.setToken(null);
        if (msg.reason === "replaced") toast("info", "This game was opened in another tab.");
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
    playCard: (play) => send({ type: "play_card", play }, true),
    openBook() {
      if (!get().busy) send({ type: "open_book" }, true);
    },
    setTarget: (targets) => send({ type: "set_target", targets }, true),
    emote: (emote) => send({ type: "emote", emote }),
    rematch: () => send({ type: "rematch" }),
    leave: () => send({ type: "leave" }),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
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
