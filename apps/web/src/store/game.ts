import { create } from "zustand";
import type { GameEvent, GameState, PlayerIndex, RulesOverrides } from "@paper-duel/engine";
import type { ClientMessage, ErrorCode, RoomView, ServerMessage } from "@paper-duel/protocol";
import { GameSocket, defaultSocketUrl, type ConnectionStatus } from "../net/socket.js";

const NAME_KEY = "paper-duel:name";

export interface Toast {
  id: number;
  code: ErrorCode | "info";
  message: string;
}

export interface GameStore {
  connection: ConnectionStatus;
  name: string;
  you: PlayerIndex | null;
  code: string | null;
  room: RoomView | null;
  game: GameState | null;
  /** Events from the most recent turn_result, for highlighting. */
  lastEvents: GameEvent[];
  lastAuto: boolean;
  timer: { player: PlayerIndex; deadline: number | null } | null;
  opponent: { connected: boolean; graceDeadline: number | null } | null;
  /** Server clock minus local clock, so countdowns match the server. */
  clockOffset: number;
  /** An action is in flight; block double clicks until the server answers. */
  busy: boolean;
  toasts: Toast[];

  setName(name: string): void;
  createRoom(rules?: RulesOverrides): void;
  joinRoom(code: string): void;
  quickMatch(): void;
  setRules(rules: RulesOverrides): void;
  setReady(ready: boolean): void;
  openBook(): void;
  choose(attack: boolean): void;
  rematch(): void;
  leave(): void;
  dismissToast(id: number): void;
}

let socket: GameSocket | null = null;
let toastId = 0;
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
  lastAuto: false,
  timer: null,
  opponent: null,
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
    const t = { id: ++toastId, code, message };
    set((s) => ({ toasts: [...s.toasts.slice(-2), t] }));
    setTimeout(() => get().dismissToast(t.id), 4000);
  };

  const onMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case "joined":
        socket?.setToken(msg.sessionToken);
        return set({ you: msg.you, code: msg.code });
      case "room_state":
        return set({ room: msg.room, ...(msg.room.phase === "lobby" ? { game: null } : {}) });
      case "game_started":
        return set({ game: msg.game, lastEvents: [], lastAuto: false, busy: false });
      case "game_state":
        return set({ game: msg.game, busy: false });
      case "turn_result":
        return set({ game: msg.game, lastEvents: msg.events, lastAuto: msg.auto, busy: false });
      case "turn_timer":
        return set({ timer: { player: msg.player, deadline: msg.deadline } });
      case "opponent_status":
        return set({ opponent: { connected: msg.connected, graceDeadline: msg.graceDeadline } });
      case "game_over":
        return set({ game: msg.game, timer: null, busy: false });
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

  handleMessage = onMessage;

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
    createRoom: (rules) =>
      send({ type: "create_room", name: get().name, ...(rules ? { rules } : {}) }, true),
    joinRoom: (code) => send({ type: "join_room", code, name: get().name }, true),
    quickMatch: () => send({ type: "quick_match", name: get().name }, true),
    setRules: (rules) => send({ type: "set_rules", rules }),
    setReady: (ready) => send({ type: "ready", ready }),
    openBook() {
      if (!get().busy) send({ type: "open_book" }, true);
    },
    choose(attack) {
      if (!get().busy) send({ type: "choose", attack }, true);
    },
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
