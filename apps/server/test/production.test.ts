import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { startGame, startServer, type TestServer } from "./client.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("metrics", () => {
  it("exposes Prometheus counters that track games", async () => {
    server = await startServer();
    const metric = async (name: string) => {
      const text = await (await fetch(`${server!.baseUrl}/metrics`)).text();
      const line = text.split("\n").find((l) => l.startsWith(`${name} `));
      return Number(line?.split(" ")[1]);
    };
    expect(await metric("paper_duel_games_started_total")).toBe(0);
    const { clients } = await startGame(server, 3);
    expect(await metric("paper_duel_games_started_total")).toBe(1);
    expect(await metric("paper_duel_players_in_games_total")).toBe(3);
    expect(await metric("paper_duel_rooms_playing")).toBe(1);
    expect(await metric("paper_duel_connections")).toBe(3);
    clients[1]!.send({ type: "leave" });
    clients[2]!.send({ type: "leave" });
    await clients[0]!.next("game_over");
    expect(await metric("paper_duel_games_finished_total")).toBe(1);
    const text = await (await fetch(`${server.baseUrl}/metrics`)).text();
    expect(text).toContain("# TYPE paper_duel_games_finished_total counter");
  });
});

describe("logs", () => {
  it("record game events by room code, never player names", async () => {
    const logs: { msg: string; fields: Record<string, unknown> }[] = [];
    server = await startServer({ onLog: (msg, fields) => logs.push({ msg, fields }) });
    const { clients, code } = await startGame(server, 2);
    clients[1]!.send({ type: "leave" });
    await clients[0]!.next("game_over");
    expect(logs.map((l) => l.msg)).toEqual(["game started", "game finished"]);
    expect(logs[0]!.fields).toMatchObject({ room: code, players: 2 });
    expect(logs[1]!.fields).toMatchObject({ room: code, reason: "last_standing" });
    expect(JSON.stringify(logs)).not.toMatch(/P0|P1/);
  });
});

describe("static client", () => {
  const site = () => {
    const dir = mkdtempSync(join(tmpdir(), "pd-static-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Paper Duel</title>");
    writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
    return dir;
  };

  it("serves the page uncached and hashed assets cached for a year", async () => {
    const { app } = await buildApp({ staticDir: site() });
    const page = await app.inject("/");
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>Paper Duel</title>");
    expect(page.headers["cache-control"]).toBe("no-cache");
    const asset = await app.inject("/assets/index-abc123.js");
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await app.inject("/health")).statusCode).toBe(200);
    await app.close();
  });

  it("refuses to start without a built client", async () => {
    await expect(buildApp({ staticDir: mkdtempSync(join(tmpdir(), "pd-empty-")) })).rejects.toThrow(
      /no index.html/,
    );
  });
});
