import { defineConfig, devices } from "@playwright/test";

// Separate ports from `pnpm dev`, so the suite can run while you're developing.
const SERVER_PORT = 8790;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices["Desktop Chrome"],
    // Reveals are instant with reduced motion, which keeps games short. One test turns it off.
    reducedMotion: "reduce",
    trace: "off",
  },
  webServer: [
    {
      command: "pnpm --filter @paper-duel/server start",
      url: `http://localhost:${SERVER_PORT}/health`,
      env: { PORT: String(SERVER_PORT), LOG_LEVEL: "warn" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @paper-duel/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { SERVER_PORT: String(SERVER_PORT) },
      // The dev proxy logs a reset every time a test browser closes its socket.
      stderr: "ignore",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
