import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types.js";
import { RoomManager } from "./rooms.js";
import { registerSockets, type SocketOptions } from "./sockets.js";
import { listWordLists, loadWordList } from "./words.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server -> dist/public (Client-Bundle) und public/ (statische Dateien)
const bundleDir = path.resolve(here, "../public");
const staticDir = path.resolve(here, "../../public");

export interface App {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  manager: RoomManager;
}

export function createApp(options: SocketOptions = {}, manager = new RoomManager()): App {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/wordlists", async (_req, res) => {
    try {
      const names = await listWordLists(options.wordsDir);
      const lists = await Promise.all(
        names.map(async (name) => ({ name, count: (await loadWordList(name, options.wordsDir)).length })),
      );
      res.json(lists);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Wortlisten konnten nicht gelesen werden." });
    }
  });

  app.use(express.static(bundleDir));
  app.use(express.static(staticDir));

  // Client-Routen: Screen, Beitritt und Player teilen sich eine Seite.
  app.get(["/screen/:code", "/join", "/join/:code"], (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerSockets(io, manager, options);
  return { httpServer, io, manager };
}
