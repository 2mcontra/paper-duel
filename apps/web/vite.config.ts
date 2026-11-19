import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = process.env.SERVER_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    // The game server runs separately in dev; the client always talks to /ws on its own origin.
    proxy: { "/ws": { target: `ws://localhost:${serverPort}`, ws: true } },
  },
});
