# Paper Duel

A 2-player browser version of the pen-and-paper stick-figure gun duel, with a virtual book. See [plan.md](plan.md).

## Layout

- `packages/engine`: pure game logic (TypeScript, no I/O)
- `packages/protocol`: WebSocket message schemas shared by server and client
- `apps/server`: authoritative game server (Fastify + WebSocket)
- `apps/web`: React + Vite client

## Commands

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm lint          # ESLint
pnpm format:check  # Prettier
pnpm typecheck     # tsc in every package
pnpm test          # Vitest across all packages
pnpm build         # builds the web client
pnpm sim           # 10,000 bot games with balance stats
pnpm dev           # server on :8787 and client on :5173 (open two tabs to play yourself)
```
