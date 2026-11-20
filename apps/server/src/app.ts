import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  /** Serve the built web client from this folder (production). Unset in development. */
  staticDir?: string | undefined;
}

export async function buildApp(opts: AppOptions = {}) {
  const { logger = false, trustProxy = false, staticDir, ...overrides } = opts;
  // Per-request logs would be mostly health checks and static files; game events are logged
  // explicitly instead (see onLog).
  const app = Fastify({
    logger,
    trustProxy,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const options: ServerOptions = {
    ...DEFAULT_OPTIONS,
    onError: (err, where) => app.log.error({ err, where }, "unhandled error"),
    onLog: (msg, fields) => app.log.info(fields, msg),
    ...overrides,
  };
  const startedAt = Date.now();
  const manager = new RoomManager(options);
  const connectionsByIp = new Map<string, number>();
  const alive = new WeakMap<WebSocket, boolean>();
  const sockets = new Set<WebSocket>();

  await app.register(websocket, { options: { maxPayload: options.maxPayloadBytes } });

  // Event-loop delay: how late timers and messages run. The key "is the server keeping up" number.
  // The histogram includes its own sampling interval, which is subtracted out. A snapshot is
  // taken every 10 s, so health checks and metric scrapes don't interfere with each other.
  const RESOLUTION_MS = 10;
  const loopDelay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  const lagMs = (ns: number) => Math.max(0, Math.round((ns / 1e6 - RESOLUTION_MS) * 100) / 100);
  let lag = { p50: 0, p99: 0, max: 0 };
  loopDelay.enable();
  const lagSampler = setInterval(() => {
    lag = {
      p50: lagMs(loopDelay.percentile(50)),
      p99: lagMs(loopDelay.percentile(99)),
      max: lagMs(loopDelay.max),
    };
    loopDelay.reset();
  }, 10_000);
  lagSampler.unref?.();

  app.get("/health", async () => ({
    ok: true,
    ...manager.stats,
    memoryMb: Math.round(process.memoryUsage().rss / 1e6),
    eventLoopMs: lag,
  }));

  // Prometheus text format. Keep this off the public internet (the Caddy config blocks it).
  app.get("/metrics", async (_req, reply) => {
    const s = manager.stats;
    const c = manager.counters;
    const lines = [
      ["paper_duel_rooms", "gauge", "Open rooms", s.rooms],
      ["paper_duel_rooms_playing", "gauge", "Rooms with a game in progress", s.playing],
      ["paper_duel_connections", "gauge", "Open WebSocket connections", s.connections],
      ["paper_duel_rooms_created_total", "counter", "Rooms created", c.roomsCreated],
      ["paper_duel_games_started_total", "counter", "Games started", c.gamesStarted],
      ["paper_duel_games_finished_total", "counter", "Games finished", c.gamesFinished],
      [
        "paper_duel_players_in_games_total",
        "counter",
        "Players summed over started games",
        c.playersInGames,
      ],
      [
        "paper_duel_rooms_closed_idle_total",
        "counter",
        "Rooms closed for inactivity",
        c.roomsClosedIdle,
      ],
      ["paper_duel_messages_total", "counter", "Client messages received", c.messages],
      [
        "paper_duel_rate_limited_total",
        "counter",
        "Client messages dropped by the rate limit",
        c.rateLimited,
      ],
      [
        "paper_duel_event_loop_lag_p99_ms",
        "gauge",
        "Event-loop lag p99 over the last 10 s",
        lag.p99,
      ],
      ["paper_duel_memory_rss_bytes", "gauge", "Resident memory", process.memoryUsage().rss],
      [
        "paper_duel_uptime_seconds",
        "gauge",
        "Seconds since start",
        Math.round((Date.now() - startedAt) / 1000),
      ],
    ] as const;
    reply.type("text/plain; version=0.0.4");
    return lines
      .map(
        ([name, type, help, value]) =>
          `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`,
      )
      .join("");
  });

  if (staticDir) {
    const root = resolve(staticDir);
    if (!existsSync(resolve(root, "index.html"))) {
      throw new Error(`STATIC_DIR ${root} has no index.html; build the web app first`);
    }
    await app.register(fastifyStatic, {
      root,
      // Vite puts content-hashed files in /assets: safe to cache for a year. Everything else
      // (index.html) must be revalidated so a deploy is picked up straight away.
      setHeaders: (res, path) => {
        res.header(
          "Cache-Control",
          path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
  }

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
    clearInterval(lagSampler);
    loopDelay.disable();
    manager.shutdown();
  });

  return { app, manager };
}
