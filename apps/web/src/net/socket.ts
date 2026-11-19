import type { ClientMessage, ServerMessage } from "@paper-duel/protocol";

const TOKEN_KEY = "paper-duel:session";

/**
 * The session token lives in sessionStorage: it survives a reload of this tab, but two tabs
 * get separate sessions (so you can play yourself in two tabs while testing).
 */
export const sessionToken = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null): void {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage blocked: reconnects within this page still work via memory.
    }
  },
};

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

export interface SocketHandlers {
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}

/** WebSocket with automatic reconnect (backoff up to 5 s) and session resume. */
export class GameSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  /** Kept in memory too, in case sessionStorage is unavailable. */
  private token: string | null = sessionToken.get();

  constructor(
    private readonly url: string,
    private readonly handlers: SocketHandlers,
  ) {}

  start(): void {
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  setToken(token: string | null): void {
    this.token = token;
    sessionToken.set(token);
  }

  private open(): void {
    this.handlers.onStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus("open");
      if (this.token) this.send({ type: "resume", sessionToken: this.token });
      this.send({ type: "ping" });
      this.pingTimer = setInterval(() => this.send({ type: "ping" }), 20_000);
    };
    ws.onmessage = (ev) => {
      try {
        this.handlers.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch (err) {
        console.error("Bad message from server", err);
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.ws !== ws || this.closed) return;
      this.attempt++;
      this.handlers.onStatus("reconnecting");
      const delay = Math.min(5000, 250 * 2 ** this.attempt);
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }
}

export function defaultSocketUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
