# Deploying Paper Duel

One Docker image runs the game server and serves the web client. In production it sits behind
[Caddy](https://caddyserver.com), which handles HTTPS certificates automatically. Everything
below is in `Dockerfile`, `compose.yaml` and `deploy/`.

## On a VPS (recommended)

Any small Linux server works (1 vCPU and 1 GB RAM is plenty: the load test ran 200 games at
once in under 200 MB).

1. **Point a domain at the server.** Create a DNS `A` record (and `AAAA` for IPv6), for example
   `duel.example.com` pointing to the server's IP address.
2. **Open ports 80 and 443** in the server's firewall. Caddy needs port 80 to get the certificate.
3. **Install Docker** (Ubuntu or Debian):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
4. **Get the code and start it:**
   ```bash
   git clone https://github.com/2mcontra/paper-duel.git
   cd paper-duel
   DOMAIN=duel.example.com docker compose up -d --build
   ```
5. Open `https://duel.example.com`. The first visit can take a few seconds while Caddy gets the
   certificate.

To avoid typing `DOMAIN` every time, put it in a `.env` file next to `compose.yaml`:

```
DOMAIN=duel.example.com
```

### Updating

```bash
git pull
docker compose up -d --build
```

Games in progress end when the server restarts: players see "reconnecting" and get sent back to
the start page. Update when nobody is playing, or accept that.

### Logs and metrics

```bash
docker compose logs -f app
```

Logs are JSON lines (one per game started or finished, plus warnings and errors). They contain
room codes and counts, never player names.

Metrics in Prometheus format are at `/metrics` inside the Docker network. Caddy blocks them from
the internet. To look at them:

```bash
docker compose exec caddy wget -qO- http://app:8787/metrics
```

Useful ones: `paper_duel_rooms_playing` (games right now), `paper_duel_connections`,
`paper_duel_games_started_total` and `paper_duel_games_finished_total` (with Prometheus,
`increase(paper_duel_games_finished_total[1h])` gives games per hour), and
`paper_duel_event_loop_lag_p99_ms` (should stay in single digits; much higher means the server
is overloaded).

`/health` returns a short JSON status and is what the container health check uses.

## Settings

Set these in `compose.yaml` (the `app` service) or with `-e` on `docker run`.

| Variable                 | Default               | What it does                                                                              |
| ------------------------ | --------------------- | ----------------------------------------------------------------------------------------- |
| `DOMAIN`                 | (required by compose) | Your domain. Caddy gets its certificate; `ALLOWED_ORIGINS` is set from it                 |
| `ALLOWED_ORIGINS`        | any                   | Comma-separated origins allowed to open game connections, e.g. `https://duel.example.com` |
| `TRUST_PROXY`            | `false`               | Set `true` only behind a reverse proxy, so per-IP limits see real client IPs              |
| `PORT` / `HOST`          | `8787` / `0.0.0.0`    | Where the server listens inside the container                                             |
| `LOG_LEVEL`              | `info`                | `debug`, `info`, `warn` or `error`                                                        |
| `MAX_ROOMS`              | `1000`                | Most rooms open at once                                                                   |
| `MAX_CONNECTIONS_PER_IP` | `20`                  | Raise it if many players share one IP (a school or office network)                        |

## Without Caddy

`deploy/nginx.conf` is an equivalent nginx setup (with certbot certificates). The important
parts for any proxy: pass the WebSocket upgrade for `/ws`, set `X-Forwarded-For`, keep idle
connections open for at least 60 s, and don't expose `/metrics`.

Run the container with only a local port published:

```bash
docker build -t paper-duel .
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 \
  -e ALLOWED_ORIGINS=https://duel.example.com -e TRUST_PROXY=true paper-duel
```

## Other hosts

Any platform that runs a container and terminates HTTPS for you (Fly.io, Render, Railway,
Google Cloud Run with WebSockets, ...) works: deploy the `Dockerfile`, expose port 8787, set
`ALLOWED_ORIGINS` to your public URL and `TRUST_PROXY=true`. Run **one** instance: rooms live in
memory, so players in the same room must reach the same server process.

## Trying the production setup locally

```bash
DOMAIN=localhost docker compose up -d --build
```

Then open `https://localhost` and accept the browser warning (Caddy uses its own local
certificate for `localhost`). Run the browser tests against it with:

```bash
E2E_BASE_URL=https://localhost pnpm e2e
```

### If Docker Hub rate-limits you

Build from a mirror of the official images:

```bash
NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim \
CADDY_IMAGE=mirror.gcr.io/library/caddy:2 \
DOMAIN=localhost docker compose up -d --build
```
