// Bundles the server and everything it imports (workspace packages and npm dependencies)
// into one ESM file, so the production image needs only Node and this file.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  legalComments: "linked",
  // Optional native speed-ups for `ws`; it works without them.
  external: ["bufferutil", "utf-8-validate"],
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});
