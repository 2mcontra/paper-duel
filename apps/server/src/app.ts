import websocket from "@fastify/websocket";
import Fastify, { type FastifyServerOptions } from "fastify";
import { DEFAULT_OPTIONS, type ServerOptions } from "./config.js";
import { RoomManager } from "./rooms.js";

export interface AppOptions extends Partial<ServerOptions> {
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(opts: AppOptions = {}) {
  const { logger = false, ...overrides } = opts;
  const options: ServerOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const manager = new RoomManager(options);
  const app = Fastify({ logger });

  await app.register(websocket, { options: { maxPayload: options.maxPayloadBytes } });

  app.get("/health", async () => ({ ok: true, ...manager.stats }));

  app.get("/ws", { websocket: true }, (socket) => {
    const conn = manager.connect((msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        conn.send({
          type: "error",
          code: "bad_message",
          message: "Binary frames are not supported",
        });
        return;
      }
      try {
        manager.handle(conn, data.toString());
      } catch (err) {
        app.log.error({ err }, "unhandled error in message handler");
        conn.send({ type: "error", code: "bad_message", message: "Internal error" });
      }
    });
    socket.on("close", () => manager.disconnect(conn));
  });

  app.addHook("onClose", async () => manager.shutdown());

  return { app, manager };
}
