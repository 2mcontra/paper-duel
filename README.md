# Paper Duel

A 2-player browser version of the pen-and-paper stick-figure gun duel, with a virtual book. See [plan.md](plan.md).

## Layout

- `packages/engine`: pure game logic (TypeScript, no I/O)
- `apps/server`: authoritative game server (stub until M2)
- `apps/web`: React + Vite client (placeholder until M3)

## Commands

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm lint          # ESLint
pnpm format:check  # Prettier
pnpm typecheck     # tsc in every package
pnpm test          # Vitest across all packages
pnpm build         # builds the web client
pnpm --filter @paper-duel/web dev
```
