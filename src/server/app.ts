import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types.js";
import { RoomManager } from "./rooms.js";
import { registerSockets, type SocketOptions } from "./sockets.js";
import { wordListInfos } from "./words.js";

// src/server (Dev) und dist/server (Build) liegen beide zwei Ebenen unter dem Projektordner.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundleDir = path.join(projectRoot, "dist/public"); // Client-Bundle von esbuild
const staticDir = path.join(projectRoot, "public");

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
    res.json(await wordListInfos(options.wordsDir));
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
