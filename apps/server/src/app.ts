import websocket from "@fastify/websocket";
import Fastify, { type FastifyServerOptions } from "fastify";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { WebSocket } from "ws";
import { DEFAULT_OPTIONS, type ServerOptions } from "./config.js";
import { RoomManager } from "./rooms.js";

export interface AppOptions extends Partial<ServerOptions> {
  logger?: FastifyServerOptions["logger"];
  /**
   * Trust X-Forwarded-For from a reverse proxy (needed for per-IP limits behind one).
   * Only enable when the server is not reachable directly.
   */
  trustProxy?: FastifyServerOptions["trustProxy"];
}

export async function buildApp(opts: AppOptions = {}) {
  const { logger = false, trustProxy = false, ...overrides } = opts;
  const app = Fastify({ logger, trustProxy });
  const options: ServerOptions = {
    ...DEFAULT_OPTIONS,
    onError: (err, where) => app.log.error({ err, where }, "unhandled error"),
    ...overrides,
  };
  const manager = new RoomManager(options);
  const connectionsByIp = new Map<string, number>();
  const alive = new WeakMap<WebSocket, boolean>();
  const sockets = new Set<WebSocket>();

  await app.register(websocket, { options: { maxPayload: options.maxPayloadBytes } });

  // Event-loop delay: how late timers and messages run. The key "is the server keeping up" number.
  // The histogram includes its own sampling interval, which is subtracted out.
  const RESOLUTION_MS = 10;
  const loopDelay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  const lagMs = (ns: number) => Math.max(0, Math.round((ns / 1e6 - RESOLUTION_MS) * 100) / 100);
  loopDelay.enable();
  app.get("/health", async () => {
    const mem = process.memoryUsage();
    const body = {
      ok: true,
      ...manager.stats,
      memoryMb: Math.round(mem.rss / 1e6),
      eventLoopMs: {
        p50: lagMs(loopDelay.percentile(50)),
        p99: lagMs(loopDelay.percentile(99)),
        max: lagMs(loopDelay.max),
      },
    };
    loopDelay.reset();
    return body;
  });

  app.get(
    "/ws",
    {
      websocket: true,
      // Runs before the upgrade, so refused clients never get a socket.
      preValidation: async (req, reply) => {
        const origin = req.headers.origin;
        if (options.allowedOrigins && (!origin || !options.allowedOrigins.includes(origin))) {
          return reply.code(403).send({ error: "origin not allowed" });
        }
        if ((connectionsByIp.get(req.ip) ?? 0) >= options.maxConnectionsPerIp) {
          return reply.code(429).send({ error: "too many connections" });
        }
      },
    },
    (socket, req) => {
      const ip = req.ip;
      connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
      sockets.add(socket);
      alive.set(socket, true);
      socket.on("pong", () => alive.set(socket, true));

      const conn = manager.connect((msg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      }, ip);
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
      socket.on("close", () => {
        sockets.delete(socket);
        const left = (connectionsByIp.get(ip) ?? 1) - 1;
        if (left > 0) connectionsByIp.set(ip, left);
        else connectionsByIp.delete(ip);
        manager.disconnect(conn);
      });
    },
  );

  // Drop connections that stopped answering pings (closed laptop, dead mobile network).
  // Their seat then gets the normal reconnect grace period.
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!alive.get(socket)) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, options.heartbeatMs);
  heartbeat.unref?.();

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    loopDelay.disable();
    manager.shutdown();
  });

  return { app, manager };
}
