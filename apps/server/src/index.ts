import { buildApp } from "./app.js";

const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? "0.0.0.0";
const list = (v: string | undefined) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

const { app } = await buildApp({
  logger: { level: env.LOG_LEVEL ?? "info" },
  // e.g. ALLOWED_ORIGINS=https://duel.example,https://www.duel.example
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  // Set TRUST_PROXY=true behind a reverse proxy so per-IP limits see real client IPs.
  trustProxy: env.TRUST_PROXY === "true",
  // In production the server also serves the built web client, e.g. STATIC_DIR=./public
  staticDir: env.STATIC_DIR,
  ...(env.MAX_ROOMS ? { maxRooms: Number(env.MAX_ROOMS) } : {}),
  ...(env.MAX_CONNECTIONS_PER_IP
    ? { maxConnectionsPerIp: Number(env.MAX_CONNECTIONS_PER_IP) }
    : {}),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host });
